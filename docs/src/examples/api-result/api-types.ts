export type UserData = { id: number; name: string };
export type Order = { id: number; total: number };

export type Api = {
  getUser(): Promise<UserData>;
  getOrders(): Promise<Order[]>;
};
