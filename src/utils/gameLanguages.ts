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
