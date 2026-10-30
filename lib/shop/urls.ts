import { getEnv } from "@/lib/env";

// Links handed to agents and humans. Pages land in 5.6 (`/p`, `/o`) and 5.7 (`/api/photos`).

const base = () => getEnv().APP_BASE_URL;

export const productUrl = (slug: string) => `${base()}/p/${encodeURIComponent(slug)}`;

export const statusUrl = (statusToken: string) => `${base()}/o/${statusToken}`;

export const photoUrl = (photoId: string) => `${base()}/api/photos/${photoId}`;
