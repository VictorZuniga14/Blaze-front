const LABELS: Record<string, string> = {
  en: "Inglés",
  es: "Español",
  "es-ES": "Español (España)",
  "es-419": "Español (Latinoamérica)",
  "pt-BR": "Portugués (Brasil)",
  pt: "Portugués",
  fr: "Francés",
  de: "Alemán",
  it: "Italiano",
  nl: "Neerlandés",
  ja: "Japonés",
  ko: "Coreano",
  zh: "Chino",
  "zh-CN": "Chino (Simplificado)",
  "zh-TW": "Chino (Tradicional)",
};

/** Vacío → solo inglés (regla del producto). */
export function resolveAvailableLanguages(
  codes: string[] | null | undefined,
): string[] {
  const cleaned = (codes ?? [])
    .map((c) => c.trim())
    .filter(Boolean);
  if (cleaned.length === 0) return ["en"];
  return [...new Set(cleaned)];
}

function isSpanishCode(code: string): boolean {
  const c = code.trim().toLowerCase();
  return c === "es" || c.startsWith("es-");
}

/**
 * Preferí español si el juego lo declara o no declara idiomas.
 * Si solo tiene otros (ej. solo `en`), respeta el primero.
 */
export function defaultPreferredLanguage(
  codes: string[] | null | undefined,
): string {
  const cleaned = (codes ?? []).map((c) => c.trim()).filter(Boolean);
  if (cleaned.length === 0) return "es";
  const es = cleaned.find(isSpanishCode);
  return es ?? cleaned[0]!;
}

/** True si debemos forzar español (soporta ES o no hay lista de idiomas). */
export function shouldForceSpanish(
  codes: string[] | null | undefined,
  preferred?: string | null,
): boolean {
  if (preferred && isSpanishCode(preferred)) return true;
  const cleaned = (codes ?? []).map((c) => c.trim()).filter(Boolean);
  if (cleaned.length === 0) return true;
  return cleaned.some(isSpanishCode);
}

export function languageLabel(code: string): string {
  return LABELS[code] ?? LABELS[code.toLowerCase()] ?? code;
}

export function parseLanguagesJson(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return raw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

export function languagesToJson(codes: string[]): string {
  return JSON.stringify(resolveAvailableLanguages(codes));
}
