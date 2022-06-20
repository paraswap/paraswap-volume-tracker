import {
  Table,
  Model,
  Column,
  PrimaryKey,
  DataType,
  Index,
} from 'sequelize-typescript';
import {
  AccountGroup,
  AccountStatus,
  RegisteredAccount,
} from '../lib/onboarding/types';
import { DataType_EMAIL_ADDRESS } from '../lib/sql-data-types';

@Table({ createdAt: false, updatedAt: false })
export class OnboardingAccount extends Model<RegisteredAccount> {
  @PrimaryKey
  @Column(DataType.UUID)
  uuid: string;

  @Index
  @Column(DataType_EMAIL_ADDRESS)
  email: string;

  @Column(DataType.STRING(100))
  share_link: string;

  @Column(DataType.STRING(100))
  share_status_link: string;

  @Column(DataType.ENUM(AccountStatus.IMPORTED, AccountStatus.APPLIED))
  status: AccountStatus;

  @Column(DataType.ENUM(AccountGroup.PSP_STAKERS, AccountGroup.WAITLIST))
  groups: AccountGroup;

  @Column(DataType.SMALLINT)
  waitlist_position: number;

  // transients fields. No need to keep up to date as db model is only used as fallback
  @Column(DataType.VIRTUAL)
  share_clicks_count = 0;

  @Column(DataType.VIRTUAL)
  share_signups_count = 0;
}
