import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExecutionContext,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';

// ponytail: simple identity toggle (auth is out of scope) — the caller says who they are.
export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<Request>().header('x-user-id');
  if (!id || !/^\d+$/.test(id)) throw new UnauthorizedException('X-User-Id header required');
  return id;
});

export function requireString(body: Record<string, unknown>, key: string): string {
  const v = body?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new BadRequestException(`${key} is required`);
  return v.trim();
}

export function requireInt(body: Record<string, unknown>, key: string, min: number): number {
  const v = body?.[key];
  if (!Number.isInteger(v) || (v as number) < min) throw new BadRequestException(`${key} must be an integer >= ${min}`);
  return v as number;
}

export function requireId(value: string): string {
  if (!/^\d+$/.test(value)) throw new BadRequestException('invalid id');
  return value;
}

/** Turns an unknown X-User-Id (foreign key violation) into a 400 instead of a 500. */
@Catch()
export class PgErrorFilter extends BaseExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    if ((err as { code?: string })?.code === '23503') {
      return super.catch(new BadRequestException('referenced user or record does not exist'), host);
    }
    return super.catch(err, host);
  }
}
