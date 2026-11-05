import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema.js';

/**
 * Data access for users. Exported globally by UsersModule.
 * Other modules: read users through this service rather than injecting the
 * User model, so password fields stay hidden.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.trim().toLowerCase() }).exec();
  }
}
