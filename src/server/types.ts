import type { User } from "../persistence/user-repository.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export {};
