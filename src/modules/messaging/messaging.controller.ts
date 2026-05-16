import {
  Controller, Get, Post, Patch, Body, Param,
  Query, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MessagingService } from './messaging.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Messages')
@ApiBearerAuth('JWT')
@Controller('messaging')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Start or get a conversation' })
  getOrCreate(
    @CurrentUser() user: any,
    @Body() body: { otherUserId: string; propertyId?: string; bookingId?: string },
  ) {
    return this.messagingService.getOrCreateConversation(
      user.id, body.otherUserId, body.propertyId, body.bookingId,
    );
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Get all conversations' })
  getConversations(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.messagingService.getConversations(user.id, page, limit);
  }

  @Get('conversations/unread-count')
  @ApiOperation({ summary: 'Get unread conversation count' })
  getUnreadCount(@CurrentUser() user: any) {
    return this.messagingService.getUnreadCount(user.id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get messages in a conversation' })
  getMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.messagingService.getMessages(id, user.id, page, limit);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send a message (REST fallback; prefer WebSocket)' })
  sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() body: { content: string; type?: string },
  ) {
    return this.messagingService.sendMessage(id, user.id, body.content, body.type);
  }

  @Patch('conversations/:id/archive')
  @ApiOperation({ summary: 'Archive a conversation' })
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.messagingService.archiveConversation(id, user.id);
  }
}
