import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { DatabaseService } from '../database/database.service';
import type { PublicUser } from '../auth/auth.types';

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  async getById(userId: string): Promise<PublicUser> {
    const result = await this.database.query<UserRow>(
      'SELECT id, email, display_name FROM users WHERE id = $1',
      [userId],
    );
    if (!result.rows[0]) throw new ApiError('NOT_FOUND', '用户不存在', 404);
    return this.toPublicUser(result.rows[0]);
  }

  async updateDisplayName(userId: string, displayName: string): Promise<PublicUser> {
    const result = await this.database.query<UserRow>(
      `UPDATE users SET display_name = $2, updated_at = current_timestamp
       WHERE id = $1 RETURNING id, email, display_name`,
      [userId, displayName],
    );
    if (!result.rows[0]) throw new ApiError('NOT_FOUND', '用户不存在', 404);
    return this.toPublicUser(result.rows[0]);
  }

  private toPublicUser(row: UserRow): PublicUser {
    return { id: row.id, email: row.email, displayName: row.display_name };
  }
}
