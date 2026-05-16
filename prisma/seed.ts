import { PrismaClient, UserRole, PropertyType, PropertyStatus, AmenityCategory } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Amenities ─────────────────────────────────────
  const amenities = [
    // Basics
    { name: 'WiFi', icon: 'wifi', category: AmenityCategory.BASICS },
    { name: 'Air Conditioning', icon: 'air-conditioning', category: AmenityCategory.BASICS },
    { name: 'Heating', icon: 'heating', category: AmenityCategory.BASICS },
    { name: 'Washer', icon: 'washer', category: AmenityCategory.BASICS },
    { name: 'Dryer', icon: 'dryer', category: AmenityCategory.BASICS },
    { name: 'TV', icon: 'tv', category: AmenityCategory.ENTERTAINMENT },
    { name: 'Netflix', icon: 'netflix', category: AmenityCategory.ENTERTAINMENT },
    // Kitchen
    { name: 'Kitchen', icon: 'kitchen', category: AmenityCategory.KITCHEN },
    { name: 'Coffee Maker', icon: 'coffee', category: AmenityCategory.KITCHEN },
    { name: 'Microwave', icon: 'microwave', category: AmenityCategory.KITCHEN },
    { name: 'Refrigerator', icon: 'fridge', category: AmenityCategory.KITCHEN },
    { name: 'Dishwasher', icon: 'dishwasher', category: AmenityCategory.KITCHEN },
    // Safety
    { name: 'Smoke Detector', icon: 'smoke-detector', category: AmenityCategory.SAFETY },
    { name: 'Carbon Monoxide Detector', icon: 'co-detector', category: AmenityCategory.SAFETY },
    { name: 'Fire Extinguisher', icon: 'fire-extinguisher', category: AmenityCategory.SAFETY },
    { name: 'First Aid Kit', icon: 'first-aid', category: AmenityCategory.SAFETY },
    // Outdoor
    { name: 'Pool', icon: 'pool', category: AmenityCategory.OUTDOOR },
    { name: 'Hot Tub', icon: 'hot-tub', category: AmenityCategory.OUTDOOR },
    { name: 'BBQ Grill', icon: 'bbq', category: AmenityCategory.OUTDOOR },
    { name: 'Parking', icon: 'parking', category: AmenityCategory.OUTDOOR },
    { name: 'Garden', icon: 'garden', category: AmenityCategory.OUTDOOR },
    // Bedroom
    { name: 'Workspace', icon: 'workspace', category: AmenityCategory.BEDROOM },
    { name: 'Hangers', icon: 'hangers', category: AmenityCategory.BEDROOM },
    { name: 'Iron', icon: 'iron', category: AmenityCategory.BEDROOM },
  ];

  for (const amenity of amenities) {
    await prisma.amenity.upsert({
      where: { name: amenity.name },
      update: {},
      create: amenity,
    });
  }
  console.log(`✅ Seeded ${amenities.length} amenities`);

  // ── Admin User ────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin@123456', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rentalplatform.com' },
    update: {},
    create: {
      email: 'admin@rentalplatform.com',
      passwordHash: adminHash,
      firstName: 'Platform',
      lastName: 'Admin',
      role: UserRole.ADMIN,
      status: 'ACTIVE',
      emailVerified: true,
      profile: { create: {} },
      wallet: { create: { currency: 'USD', balance: 0 } },
    },
  });
  console.log(`✅ Admin user: ${admin.email}`);

  // ── Demo Host ─────────────────────────────────────
  const hostHash = await bcrypt.hash('Host@123456', 12);
  const host = await prisma.user.upsert({
    where: { email: 'host@demo.com' },
    update: {},
    create: {
      email: 'host@demo.com',
      passwordHash: hostHash,
      firstName: 'Demo',
      lastName: 'Host',
      role: UserRole.HOST,
      status: 'ACTIVE',
      emailVerified: true,
      profile: { create: { superhost: true, hostSince: new Date() } },
      wallet: { create: { currency: 'USD', balance: 1500 } },
    },
  });
  console.log(`✅ Demo host: ${host.email}`);

  // ── Demo Guest ────────────────────────────────────
  const guestHash = await bcrypt.hash('Guest@123456', 12);
  const guest = await prisma.user.upsert({
    where: { email: 'guest@demo.com' },
    update: {},
    create: {
      email: 'guest@demo.com',
      passwordHash: guestHash,
      firstName: 'Demo',
      lastName: 'Guest',
      role: UserRole.GUEST,
      status: 'ACTIVE',
      emailVerified: true,
      profile: { create: {} },
      wallet: { create: { currency: 'USD', balance: 500 } },
    },
  });
  console.log(`✅ Demo guest: ${guest.email}`);

  // ── Demo Property ─────────────────────────────────
  const wifiAmenity = await prisma.amenity.findUnique({ where: { name: 'WiFi' } });
  const poolAmenity = await prisma.amenity.findUnique({ where: { name: 'Pool' } });

  const property = await prisma.property.upsert({
    where: { slug: 'demo-luxury-villa-kampala' },
    update: {},
    create: {
      hostId: host.id,
      slug: 'demo-luxury-villa-kampala',
      title: 'Demo Luxury Villa – Kampala',
      description: 'A stunning 4-bedroom villa nestled in the hills of Kampala with panoramic views of Lake Victoria. Features a private pool, spacious gardens, and world-class amenities perfect for families or corporate retreats.',
      type: PropertyType.VILLA,
      status: PropertyStatus.ACTIVE,
      address: '12 Kololo Hill Drive',
      city: 'Kampala',
      state: 'Central Region',
      country: 'Uganda',
      latitude: 0.3476,
      longitude: 32.5825,
      maxGuests: 10,
      bedrooms: 4,
      beds: 6,
      bathrooms: 4,
      squareMeters: 450,
      pricePerNight: 250,
      cleaningFee: 50,
      securityDeposit: 200,
      weeklyDiscount: 10,
      monthlyDiscount: 20,
      currency: 'USD',
      minNights: 2,
      maxNights: 30,
      instantBook: true,
      petsAllowed: false,
      smokingAllowed: false,
      eventsAllowed: true,
      checkInTime: '15:00',
      checkOutTime: '11:00',
      houseRules: 'No smoking inside. Quiet hours after 10pm. No unregistered guests.',
      cancellationPolicy: 'MODERATE',
      tags: ['villa', 'pool', 'luxury', 'family', 'kampala'],
      avgRating: 4.8,
      totalReviews: 0,
      approvedAt: new Date(),
      approvedBy: admin.id,
      // amenities: {
      //   createMany: {
      //     data: [wifiAmenity, poolAmenity].filter(Boolean).map((a) => ({ amenityId: a.id })),
      //     skipDuplicates: true,
      //   },
      // },
    },
  });
  console.log(`✅ Demo property: ${property.title}`);

  // ── System Config ─────────────────────────────────
  const configs = [
    { key: 'platform.serviceFeePercent', value: 12, description: 'Platform service fee %' },
    { key: 'platform.hostFeePercent', value: 3, description: 'Host processing fee %' },
    { key: 'platform.minBookingAmount', value: 10, description: 'Minimum booking amount (USD)' },
    { key: 'platform.maxGuestsDefault', value: 16, description: 'Default max guests' },
    { key: 'platform.reviewWindowDays', value: 14, description: 'Days to leave a review after checkout' },
    { key: 'platform.payoutDelayDays', value: 1, description: 'Days after checkout before payout' },
    { key: 'platform.currencies', value: ['USD', 'EUR', 'GBP', 'UGX', 'KES', 'NGN', 'ZAR', 'GHS'], description: 'Supported currencies' },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: { value: config.value as any },
      create: { key: config.key, value: config.value as any, description: config.description },
    });
  }
  console.log(`✅ Seeded ${configs.length} system config entries`);

  console.log('\n🎉 Database seeded successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔑 Admin:  admin@rentalplatform.com / Admin@123456');
  console.log('🏠 Host:   host@demo.com           / Host@123456');
  console.log('👤 Guest:  guest@demo.com           / Guest@123456');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
