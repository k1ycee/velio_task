import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { UserId, requireId } from '../common/http.js';
import { InvitesService } from './invites.service.js';

@Controller()
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post('plans/:id/invites')
  async create(
    @UserId() userId: string,
    @Param('id') planId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const type = body?.type;
    if (type !== 'vouch' && type !== 'public') throw new BadRequestException('type must be "vouch" or "public"');
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null;
    const { created, invite } = await this.invites.create(userId, requireId(planId), type, label);
    if (!created) res.status(200);
    return invite;
  }

  @Get('invites/:token')
  open(@Param('token') token: string, @Headers('x-user-id') viewerId?: string) {
    return this.invites.open(token, viewerId && /^\d+$/.test(viewerId) ? viewerId : null);
  }

  @Post('invites/:token/claim')
  claim(@UserId() userId: string, @Param('token') token: string) {
    return this.invites.claim(userId, token);
  }
}
