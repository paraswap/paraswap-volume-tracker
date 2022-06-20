export type AccountToCreate = {
  email: string;
  referrer_id: string;
  profile?: {
    ip?: string;
  };
};

export enum AccountStatus {
  IMPORTED = 'imported',
  APPLIED = 'applied',
}

export enum AccountGroup {
  PSP_STAKERS = 'PSP stakers',
  WAITLIST = 'Waitlist',
}

export type RegisteredAccount = {
  uuid: string;
  email: string;
  status: AccountStatus;
  share_clicks_count: number;
  share_signups_count: number;
  share_link: string;
  share_status_link: string;
  waitlist_position: number;
  groups: AccountGroup;
};

export type AuthToken = { token: string; exp: number };
