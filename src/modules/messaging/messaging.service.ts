import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MessagingService {
  constructor(private prisma: PrismaService) {}

  async getOrCreateConversation(
    userId: string,
    otherUserId: string,
    propertyId?: string,
    bookingId?: string,
  ) {
    // Look for existing conversation between these two users
    const existing = await this.prisma.conversation.findFirst({
      where: {
        ...(bookingId ? { bookingId } : {}),
        participants: {
          every: { userId: { in: [userId, otherUserId] } },
        },
      },
      include: { participants: true },
    });
    if (existing) return existing;

    // Create new conversation
    return this.prisma.conversation.create({
      data: {
        propertyId,
        bookingId,
        participants: {
          createMany: {
            data: [{ userId }, { userId: otherUserId }],
          },
        },
      },
      include: {
        participants: {
          include: { user: { select: { id: true, firstName: true, avatarUrl: true } } },
        },
      },
    });
  }

  async getConversations(userId: string, page = 1, limit = 20) {
    return this.prisma.paginate(
      this.prisma.conversation,
      {
        where: {
          participants: { some: { userId, isActive: true } },
          isArchived: false,
        },
        include: {
          participants: {
            include: { user: { select: { id: true, firstName: true, avatarUrl: true } } },
          },
          property: { select: { id: true, title: true } },
          booking: { select: { id: true, bookingNumber: true, status: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { lastMessageAt: 'desc' },
      },
      page, limit,
    );
  }

  async getMessages(conversationId: string, userId: string, page = 1, limit = 50) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) throw new ForbiddenException('Not a participant in this conversation');

    // Mark messages as read
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() },
    });

    return this.prisma.paginate(
      this.prisma.message,
      {
        where: { conversationId, deletedAt: null },
        include: {
          sender: { select: { id: true, firstName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      page, limit,
    );
  }

  async sendMessage(conversationId: string, senderId: string, content: string, type = 'text') {
    if (!content.trim()) throw new BadRequestException('Message cannot be empty');

    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: senderId } },
    });
    if (!participant) throw new ForbiddenException('Not authorized');

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId, senderId, content, type },
        include: { sender: { select: { id: true, firstName: true, avatarUrl: true } } },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return message;
  }

  async archiveConversation(conversationId: string, userId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) throw new ForbiddenException('Not authorized');

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { isArchived: true },
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    const conversations = await this.prisma.conversationParticipant.findMany({
      where: { userId, isActive: true },
      include: {
        conversation: {
          select: { lastMessageAt: true },
        },
      },
    });

    let unread = 0;
    for (const p of conversations) {
      if (!p.lastReadAt || (p.conversation.lastMessageAt && p.conversation.lastMessageAt > p.lastReadAt)) {
        unread++;
      }
    }
    return unread;
  }
}
