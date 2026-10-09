import bannerCrash from "../assets/banner_crash_1920x620.jpg";
import bannerDonkeyKong from "../assets/donkey-kon-banner.jpg";
import bannerGodOfWar from "../assets/banner-GoW.jpg";
import bannerGodOfWarII from "../assets/banner-GowII.jpg";
import bannerCarbon from "../assets/banner-Carbon.jpg";
import bannerUnderground from "../assets/undergroun-banner.jpg";
import bannerUnderground2 from "../assets/undergroound-2-banner.webp";
import bannerMario from "../assets/mario-banner.jpg";
import bannerTonyHawk from "../assets/tony-hawks-banner.jpg";
import bannerApertura from "../assets/banner_apertura-banner.png";
import bannerJackass from "../assets/banner_jackass_negro.png";
import bannerBlack from "../assets/banner_black_foto_3840x1240.png";
import bannerFifaStreet from "../assets/banner-fifastret.jpeg";
import bannerWinningEleven from "../assets/winning-eleven.jpeg";

/**
 * Banner horizontal del detalle (no es la carátula 3:4).
 * Por ahora solo assets locales de prueba; después puede venir del catálogo.
 */
export function resolveGameBanner(title: string | null | undefined): string | null {
  const t = (title ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("crash bandicoot")) return bannerCrash;
  if (t.includes("donkey kong")) return bannerDonkeyKong;
  if (t.includes("mario")) return bannerMario;
  if (t.includes("tony hawk")) return bannerTonyHawk;
  if (t.includes("jackass")) return bannerJackass;
  if (t.includes("fifa street")) return bannerFifaStreet;
  if (t.includes("winning eleven")) return bannerWinningEleven;
  // "Black" (PS2), sin Black Ops / etc.
  if (
    (t === "black" || t.startsWith("black ") || t.startsWith("black[")) &&
    !t.includes("ops") &&
    !t.includes("bandicoot")
  ) {
    return bannerBlack;
  }
  // II antes que el genérico "god of war".
  if (t.includes("god of war ii") || t.includes("god of war 2")) {
    return bannerGodOfWarII;
  }
  if (t.includes("god of war")) return bannerGodOfWar;
  if (t.includes("carbon")) return bannerCarbon;
  // Underground 2 antes que Underground 1.
  if (t.includes("underground 2") || t.includes("underground ii")) {
    return bannerUnderground2;
  }
  if (t.includes("underground")) return bannerUnderground;
  if (t.includes("apertura") || t.includes("liga chilena")) {
    return bannerApertura;
  }
  return null;
}
