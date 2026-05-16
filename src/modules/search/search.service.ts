import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PropertyFilterDto } from '../properties/dto/property-filter.dto';

const PROPERTY_INDEX = 'properties';

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private esClient: Client;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {
    this.esClient = new Client({
      node: configService.get<string>('ELASTICSEARCH_NODE', 'http://localhost:9200'),
      auth: {
        username: configService.get<string>('ELASTICSEARCH_USERNAME', 'elastic'),
        password: configService.get<string>('ELASTICSEARCH_PASSWORD', ''),
      },
    });
  }

  async onModuleInit() {
    await this.ensureIndex().catch((e) =>
      this.logger.error('ES index setup failed:', e.message),
    );
  }

  // ── Index Property ────────────────────────────────
  async indexProperty(property: any): Promise<void> {
    await this.esClient.index({
      index: PROPERTY_INDEX,
      id: property.id,
      document: {
        id: property.id,
        title: property.title,
        description: property.description,
        type: property.type,
        status: property.status,
        city: property.city,
        state: property.state,
        country: property.country,
        address: property.address,
        location: { lat: property.latitude, lon: property.longitude },
        pricePerNight: property.pricePerNight,
        currency: property.currency,
        maxGuests: property.maxGuests,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        avgRating: property.avgRating,
        totalReviews: property.totalReviews,
        instantBook: property.instantBook,
        tags: property.tags,
        cancellationPolicy: property.cancellationPolicy,
        hostId: property.hostId,
        amenities: property.amenities?.map((a: any) => a.amenity?.name),
        isPrimary: property.images?.find((i: any) => i.isPrimary)?.url,
        indexedAt: new Date().toISOString(),
      },
    });
  }

  // ── Remove Property from Index ────────────────────
  async removeProperty(propertyId: string): Promise<void> {
    await this.esClient.delete({ index: PROPERTY_INDEX, id: propertyId }).catch(() => {});
  }

  // ── Full-Text + Geo Search ────────────────────────
  async searchProperties(filters: PropertyFilterDto) {
    const {
      query, city, country, minPrice, maxPrice, minGuests,
      type, amenities, minRating, checkIn, checkOut,
      sortBy = 'avgRating', sortOrder = 'desc',
      page = 1, limit = 20,
    } = filters;

    const must: any[] = [{ term: { status: 'ACTIVE' } }];
    const filter: any[] = [];

    // Full-text search across title, description, city
    if (query) {
      must.push({
        multi_match: {
          query,
          fields: ['title^3', 'description', 'city^2', 'address', 'tags'],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      });
    }

    // Location filters
    if (city) filter.push({ match: { city: { query: city, fuzziness: 1 } } });
    if (country) filter.push({ term: { country } });
    if (type) filter.push({ term: { type } });

    // Price range
    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.push({ range: { pricePerNight: {
        ...(minPrice !== undefined && { gte: minPrice }),
        ...(maxPrice !== undefined && { lte: maxPrice }),
      }}});
    }

    // Guest capacity
    if (minGuests) filter.push({ range: { maxGuests: { gte: minGuests } } });

    // Rating filter
    if (minRating) filter.push({ range: { avgRating: { gte: minRating } } });

    // Amenities
    if (amenities?.length) {
      filter.push({ terms_set: {
        amenities: { terms: amenities, minimum_should_match_script: { source: 'params.num_terms', params: { num_terms: 1 } } }
      }});
    }

    // Build sort
    const sort: any[] = [];
    if (sortBy === 'price') sort.push({ pricePerNight: { order: sortOrder } });
    else if (sortBy === 'rating') sort.push({ avgRating: { order: sortOrder } });
    else if (query) sort.push('_score'); // relevance sort for text queries
    else sort.push({ indexedAt: { order: 'desc' } });

    const from = (page - 1) * limit;

    const response = await this.esClient.search({
      index: PROPERTY_INDEX,
      from,
      size: Math.min(limit, 50),
      query: {
        bool: {
          must,
          filter,
        },
      },
      sort,
      highlight: query ? {
        fields: { title: {}, description: { fragment_size: 150, number_of_fragments: 1 } },
      } : undefined,
      aggs: {
        avg_price: { avg: { field: 'pricePerNight' } },
        price_ranges: {
          range: {
            field: 'pricePerNight',
            ranges: [
              { to: 50 }, { from: 50, to: 100 }, { from: 100, to: 200 },
              { from: 200, to: 500 }, { from: 500 },
            ],
          },
        },
        by_type: { terms: { field: 'type' } },
        by_country: { terms: { field: 'country', size: 20 } },
      },
    });

    const hits = response.hits.hits;
    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : (response.hits.total as any)?.value || 0;

    return {
      data: hits.map((h) => ({
        ...(h._source as any),
        score: h._score,
        highlights: (h as any).highlight,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      aggregations: {
        avgPrice: (response.aggregations?.avg_price as any)?.value,
        priceRanges: (response.aggregations?.price_ranges as any)?.buckets,
        byType: (response.aggregations?.by_type as any)?.buckets,
        byCountry: (response.aggregations?.by_country as any)?.buckets,
      },
    };
  }

  // ── Geo-distance Search (nearby properties) ───────
  async searchNearby(lat: number, lon: number, radiusKm = 25, filters: Partial<PropertyFilterDto> = {}) {
    const { minPrice, maxPrice, minGuests, type, page = 1, limit = 20 } = filters;

    const filterClauses: any[] = [
      { term: { status: 'ACTIVE' } },
      { geo_distance: { distance: `${radiusKm}km`, location: { lat, lon } } },
    ];

    if (minPrice || maxPrice) {
      filterClauses.push({ range: { pricePerNight: {
        ...(minPrice && { gte: minPrice }),
        ...(maxPrice && { lte: maxPrice }),
      }}});
    }
    if (minGuests) filterClauses.push({ range: { maxGuests: { gte: minGuests } } });
    if (type) filterClauses.push({ term: { type } });

    const response = await this.esClient.search({
      index: PROPERTY_INDEX,
      from: (page - 1) * limit,
      size: limit,
      query: { bool: { filter: filterClauses } },
      sort: [
        { _geo_distance: { location: { lat, lon }, order: 'asc', unit: 'km' } },
      ],
      script_fields: {
        distance: {
          script: {
            source: `doc['location'].arcDistance(params.lat, params.lon) / 1000`,
            params: { lat, lon },
          },
        },
      },
    });

    return {
      data: response.hits.hits.map((h) => ({
        ...(h._source as any),
        distanceKm: (h.fields as any)?.distance?.[0]?.toFixed(1),
      })),
      total: (response.hits.total as any)?.value || 0,
      page, limit,
    };
  }

  // ── Autocomplete Suggestions ──────────────────────
  async autocomplete(query: string): Promise<string[]> {
    const cacheKey = `autocomplete:${query.toLowerCase()}`;
    const cached = await this.redisService.get<string[]>(cacheKey);
    if (cached) return cached;

    const response = await this.esClient.search({
      index: PROPERTY_INDEX,
      size: 5,
      query: {
        multi_match: {
          query,
          fields: ['city^3', 'country^2', 'title'],
          type: 'phrase_prefix',
        },
      },
      _source: ['city', 'country', 'title'],
    });

    const suggestions = [
      ...new Set(
        response.hits.hits.flatMap((h: any) => [
          h._source.city,
          h._source.country,
          h._source.title,
        ]).filter(Boolean),
      ),
    ].slice(0, 8) as string[];

    await this.redisService.set(cacheKey, suggestions, 300);
    return suggestions;
  }

  // ── Recommendation Engine ─────────────────────────
  async getRecommendations(userId: string, limit = 8): Promise<any[]> {
    const cacheKey = `recommendations:${userId}`;
    const cached = await this.redisService.get<any[]>(cacheKey);
    if (cached) return cached;

    // Get user's past bookings for preference signals
    const bookings = await this.prisma.booking.findMany({
      where: { guestId: userId, status: { in: ['CHECKED_OUT', 'CONFIRMED'] } },
      include: { property: { select: { type: true, city: true, pricePerNight: true, tags: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Build preference profile
    const preferredTypes = bookings.map((b) => b.property?.type).filter(Boolean);
    const preferredCities = bookings.map((b) => b.property?.city).filter(Boolean);
    const avgSpend = bookings.length
      ? bookings.reduce((s, b) => s + (b.property?.pricePerNight || 0), 0) / bookings.length
      : 100;

    // Get favorites for additional signals
    const favorites = await this.prisma.favorite.findMany({
      where: { userId },
      include: { property: { select: { type: true, city: true, tags: true } } },
    });
    const favTags = favorites.flatMap((f) => f.property?.tags || []);

    // Build ES query with user preferences
    const query: any = {
      bool: {
        filter: [{ term: { status: 'ACTIVE' } }],
        should: [
          ...(preferredTypes.length ? [{ terms: { type: preferredTypes, boost: 3 } }] : []),
          ...(preferredCities.length ? [{ terms: { city: preferredCities, boost: 2 } }] : []),
          ...(favTags.length ? [{ terms: { tags: favTags, boost: 1.5 } }] : []),
          { range: { pricePerNight: { gte: avgSpend * 0.7, lte: avgSpend * 1.5, boost: 1 } } },
          { range: { avgRating: { gte: 4, boost: 2 } } },
        ],
        minimum_should_match: 1,
      },
    };

    const response = await this.esClient.search({
      index: PROPERTY_INDEX,
      size: limit,
      query,
      sort: ['_score', { avgRating: 'desc' }],
    });

    const results = response.hits.hits.map((h) => h._source);
    await this.redisService.set(cacheKey, results, 1800); // 30 min cache
    return results;
  }

  // ── Re-index all properties ───────────────────────
  async reindexAll(): Promise<{ indexed: number; errors: number }> {
    const properties = await this.prisma.property.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      include: {
        images: { where: { isPrimary: true }, take: 1 },
        amenities: { include: { amenity: true } },
      },
    });

    let indexed = 0;
    let errors = 0;

    for (const property of properties) {
      try {
        await this.indexProperty(property);
        indexed++;
      } catch {
        errors++;
      }
    }

    this.logger.log(`Re-indexed ${indexed} properties, ${errors} errors`);
    return { indexed, errors };
  }

  // ── Private: Create ES Index ──────────────────────
  private async ensureIndex(): Promise<void> {
    const exists = await this.esClient.indices.exists({ index: PROPERTY_INDEX });
    if (exists) return;

    await this.esClient.indices.create({
      index: PROPERTY_INDEX,
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: { type: 'text', analyzer: 'standard' },
          description: { type: 'text', analyzer: 'standard' },
          type: { type: 'keyword' },
          status: { type: 'keyword' },
          city: { type: 'keyword', fields: { text: { type: 'text' } } },
          state: { type: 'keyword' },
          country: { type: 'keyword' },
          address: { type: 'text' },
          location: { type: 'geo_point' },
          pricePerNight: { type: 'float' },
          currency: { type: 'keyword' },
          maxGuests: { type: 'integer' },
          bedrooms: { type: 'integer' },
          bathrooms: { type: 'float' },
          avgRating: { type: 'float' },
          totalReviews: { type: 'integer' },
          instantBook: { type: 'boolean' },
          tags: { type: 'keyword' },
          amenities: { type: 'keyword' },
          cancellationPolicy: { type: 'keyword' },
          hostId: { type: 'keyword' },
          indexedAt: { type: 'date' },
        },
      },
      settings: {
        number_of_shards: 2,
        number_of_replicas: 1,
        analysis: {
          analyzer: { standard: { type: 'standard' } },
        },
      },
    });

    this.logger.log('Elasticsearch index created: properties');
  }
}
