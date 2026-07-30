import type { User } from "../persistence/user-repository.js";

/** Every account gets exactly one free translation; everything after is paid. */
export function isEligibleForFreeTranslation(user: User): boolean {
  return user.freeTranslationUsedAt === null;
}
