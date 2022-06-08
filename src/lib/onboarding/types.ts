export type AccountToCreate = {
  email: string;
  referrer_id: string;
  profile?: {
    ip?: string;
  };
};

export type RegisteredAccount = {
  uuid: string;
  email: string;
  status: string;
  share_clicks_count: number;
  share_signups_count: number;
  share_link: string;
  share_status_link: string;
  waitlist_position: number;
};
