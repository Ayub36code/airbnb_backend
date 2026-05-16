import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect,
  MessageBody, ConnectedSocket, WsException,
} from '@nestjs/websockets';
import { UseGuards, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '@modules/prisma/prisma.service';

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/',
  transports: ['websocket', 'polling'],
})
export class AppGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(AppGateway.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private redisService: RedisService,
    private prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('jwt.accessSecret'),
      });

      client.data.userId = payload.sub;
      client.data.role = payload.role;

      // Join user's personal room
      client.join(`user:${payload.sub}`);

      // Track online presence
      await this.redisService.sadd('online-users', payload.sub);
      await this.redisService.hset('socket-map', payload.sub, client.id);

      // Notify contacts that user is online
      this.server.emit(`presence:${payload.sub}`, { userId: payload.sub, status: 'online' });

      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch (err) {
      this.logger.warn(`Unauthorized WS connection: ${client.id}`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      await this.redisService.srem('online-users', userId);
      await this.redisService.hdel('socket-map', userId);
      this.server.emit(`presence:${userId}`, { userId, status: 'offline' });
      this.logger.log(`Client disconnected: ${client.id} (user: ${userId})`);
    }
  }

  // ── Messaging ─────────────────────────────────────
  @SubscribeMessage('join-conversation')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId;

    // Verify user is a participant
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: data.conversationId, userId } },
    });
    if (!participant) throw new WsException('Not a participant');

    client.join(`conversation:${data.conversationId}`);
    return { joined: true, conversationId: data.conversationId };
  }

  @SubscribeMessage('send-message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; content: string; type?: string },
  ) {
    const senderId = client.data.userId;

    // Verify participation
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: data.conversationId, userId: senderId } },
    });
    if (!participant) throw new WsException('Not a participant');

    const message = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          conversationId: data.conversationId,
          senderId,
          content: data.content,
          type: data.type || 'text',
        },
        include: {
          sender: { select: { id: true, firstName: true, avatarUrl: true } },
        },
      });

      await tx.conversation.update({
        where: { id: data.conversationId },
        data: { lastMessageAt: new Date() },
      });

      return msg;
    });

    // Broadcast to all participants in the room
    this.server
      .to(`conversation:${data.conversationId}`)
      .emit('new-message', message);

    // Push notification to offline participants
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: data.conversationId, userId: { not: senderId } },
      select: { userId: true },
    });

    for (const p of participants) {
      const isOnline = await this.redisService.sismember('online-users', p.userId);
      if (!isOnline) {
        // Queue push notification
        this.server.to(`user:${p.userId}`).emit('notification', {
          type: 'MESSAGE_RECEIVED',
          data: { conversationId: data.conversationId, senderId },
        });
      }
    }

    return message;
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; isTyping: boolean },
  ) {
    client.to(`conversation:${data.conversationId}`).emit('typing', {
      userId: client.data.userId,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('mark-read')
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId;
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId: data.conversationId, userId },
      data: { lastReadAt: new Date() },
    });
    return { success: true };
  }

  // ── Booking real-time updates ─────────────────────
  @SubscribeMessage('subscribe-booking')
  async subscribeToBooking(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId: string },
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: data.bookingId },
      select: { guestId: true, hostId: true },
    });
    if (!booking) throw new WsException('Booking not found');

    const userId = client.data.userId;
    if (booking.guestId !== userId && booking.hostId !== userId) {
      throw new WsException('Not authorized');
    }

    client.join(`booking:${data.bookingId}`);
    return { subscribed: true };
  }

  // ── Server-initiated events (called by services) ──
  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitToConversation(conversationId: string, event: string, data: any) {
    this.server.to(`conversation:${conversationId}`).emit(event, data);
  }

  emitBookingUpdate(bookingId: string, data: any) {
    this.server.to(`booking:${bookingId}`).emit('booking-updated', data);
  }

  async getOnlineUsers(): Promise<string[]> {
    return this.redisService.smembers('online-users');
  }

  private extractToken(client: Socket): string {
    const auth = client.handshake.auth?.token || client.handshake.headers?.authorization;
    if (!auth) throw new WsException('No token provided');
    return auth.replace('Bearer ', '');
  }
}
