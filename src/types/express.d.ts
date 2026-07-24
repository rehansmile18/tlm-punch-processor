import { UserRole } from "./domain";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: UserRole;
        clientId: string | null;
      };
    }
  }
}

export {};
