import type {
  AccountAuthResponse,
  CharacterAuthResponse,
  ProfessionId,
  TraitId,
  Appearance,
} from "@skilling-mmo/shared";
import { DEFAULT_APPEARANCE } from "@skilling-mmo/shared";

const STORAGE_KEY = "skilling_session";

export interface GameSession {
  accountToken: string;
  username: string;
  character?: {
    accessToken: string;
    playerId: string;
    displayName: string;
    profession: ProfessionId;
    traits: TraitId[];
    appearance: Appearance;
  };
}

export function loadSession(): GameSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GameSession;
  } catch {
    return null;
  }
}

export function saveSession(session: GameSession | null) {
  if (!session) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function applyAccountAuth(res: AccountAuthResponse): GameSession {
  const session: GameSession = {
    accountToken: res.accessToken,
    username: res.username,
  };
  saveSession(session);
  return session;
}

export function applyCharacterAuth(
  session: GameSession,
  res: CharacterAuthResponse,
): GameSession {
  const next: GameSession = {
    ...session,
    character: {
      accessToken: res.accessToken,
      playerId: res.playerId,
      displayName: res.displayName,
      profession: res.profession,
      traits: res.traits ?? [],
      appearance: res.appearance ?? DEFAULT_APPEARANCE,
    },
  };
  saveSession(next);
  return next;
}

export function clearCharacter(session: GameSession): GameSession {
  const next: GameSession = {
    accountToken: session.accountToken,
    username: session.username,
  };
  saveSession(next);
  return next;
}

/** Migrate legacy single-token storage from before character select. */
export function migrateLegacyAuth(): GameSession | null {
  const legacy = localStorage.getItem("skilling_auth");
  if (!legacy) return null;
  try {
    const parsed = JSON.parse(legacy) as {
      accessToken?: string;
      username?: string;
      playerId?: string;
      displayName?: string;
      profession?: ProfessionId;
      traits?: TraitId[];
      appearance?: Appearance;
    };
    localStorage.removeItem("skilling_auth");
    if (parsed.accessToken && parsed.username && parsed.playerId && parsed.displayName) {
      const session: GameSession = {
        accountToken: parsed.accessToken,
        username: parsed.username,
        character: {
          accessToken: parsed.accessToken,
          playerId: parsed.playerId,
          displayName: parsed.displayName,
          profession: parsed.profession ?? "woodsman",
          traits: parsed.traits ?? [],
          appearance: parsed.appearance ?? DEFAULT_APPEARANCE,
        },
      };
      saveSession(session);
      return session;
    }
    if (parsed.accessToken && parsed.username) {
      const session: GameSession = {
        accountToken: parsed.accessToken,
        username: parsed.username,
      };
      saveSession(session);
      return session;
    }
  } catch {
    localStorage.removeItem("skilling_auth");
  }
  return null;
}

export function activeGameToken(session: GameSession): string | null {
  return session.character?.accessToken ?? null;
}
