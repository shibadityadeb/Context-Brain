import type { UserProfile } from '@company-brain/types';
import type { User } from '@prisma/client';
import { NotFoundError } from '../../utils/errors.js';
import type { UserRepository } from './user.repository.js';

function toProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundError('User');
    return toProfile(user);
  }

  async updateProfile(userId: string, name: string): Promise<UserProfile> {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundError('User');
    return toProfile(await this.repo.updateName(userId, name));
  }

  async listUsers(): Promise<UserProfile[]> {
    return (await this.repo.listUsers()).map(toProfile);
  }
}
