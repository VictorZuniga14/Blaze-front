export type GameRegion = "ntsc-u" | "pal" | "ntsc-j";

const REGION_TAGS: Array<{ region: GameRegion; pattern: RegExp }> = [
  { region: "ntsc-u", pattern: /\b(usa|us|ntsc-u|ntsc-us)\b/i },
  {
    region: "pal",
    pattern:
      /\b(europe|eur|eu|pal|uk|spain|france|germany|italy|netherlands|portugal|australia)\b/i,
  },
  { region: "ntsc-j", pattern: /\b(japan|jpn|jp|ntsc-j)\b/i },
];

/**
 * Región por los tags estilo Redump/No-Intro: `God of War (USA).iso`,
 * `[PAL]`, `(Europe) (En,Fr,De,Es,It)`. Revisa las fuentes en orden
 * (nombre de archivo antes que título). null si no hay tag reconocible.
 */
export function detectGameRegion(
  ...sources: Array<string | null | undefined>
): GameRegion | null {
  for (const source of sources) {
    const tags = source?.match(/[([][^)\]]*[)\]]/g) ?? [];
    for (const tag of tags) {
      const hit = REGION_TAGS.find(({ pattern }) => pattern.test(tag));
      if (hit) return hit.region;
    }
  }
  return null;
}

export function regionLabel(region: GameRegion): string {
  if (region === "ntsc-u") return "NTSC-U (USA)";
  if (region === "ntsc-j") return "NTSC-J (Japón)";
  return "PAL (Europa)";
}

/**
 * Aviso si la región no puede mostrar el idioma pedido: las versiones
 * NTSC-U / NTSC-J traen un solo idioma y el parche de BIOS no lo cambia.
 */
export function regionLanguageWarning(
  region: GameRegion | null,
  languageCode: string | null | undefined,
): string | null {
  const lang = languageCode?.trim().toLowerCase() ?? "";
  if (!region || region === "pal" || !lang) return null;
  if (region === "ntsc-u" && lang !== "en" && !lang.startsWith("en-")) {
    return "Esta versión es NTSC-U (USA): viene solo en inglés y la BIOS no puede cambiarlo. Para jugar en español usá la versión PAL (Europe).";
  }
  if (region === "ntsc-j" && lang !== "ja") {
    return "Esta versión es NTSC-J (Japón): viene solo en japonés. Para otros idiomas usá la versión PAL (Europe).";
  }
  return null;
}
