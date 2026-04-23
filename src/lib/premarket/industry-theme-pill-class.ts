/**
 * Maps freeform daily-theme industry labels to scoped premarket pill classes.
 * Order matters: first matching bucket wins (more specific phrases before broad terms).
 */
export function industryThemePillClass(industry: string): string {
  const s = industry.trim().toLowerCase();
  if (!s) return "theme-industry-pill-neutral";

  const hit = (words: string[]) => words.some((w) => s.includes(w));

  if (hit(["real estate", "reit", "homebuild", "property manag", "mortgage reit", "residential"]))
    return "theme-industry-pill-realestate";
  if (hit(["electric util", "water util", "regulated util", "utility", "utilities", "power grid"]))
    return "theme-industry-pill-utilities";
  if (hit(["bank", "financial serv", "insurance", "fintech", "capital market", "asset manag", "wealth manag", "lending", "credit card", "reinsur", "brokerage", "custody", "payment process", "asset serv"]))
    return "theme-industry-pill-financial";
  if (hit(["biotech", "pharma", "health care", "healthcare", "medical", "life sci", "hospital", "diagnostic", "therapeutic", "genomic"]))
    return "theme-industry-pill-healthcare";
  if (hit(["solar", "wind power", "wind ", "renewable", "clean energy", "green energy", "hydrogen "]))
    return "theme-industry-pill-cleanenergy";
  if (
    hit([
      "oil",
      "gas",
      "petroleum",
      "drilling",
      "refin",
      "midstream",
      "upstream",
      "coal",
      "uranium",
      " lng",
      "integrated oil",
      "oilfield",
      "energy equipment",
      "oil & gas",
      "oil and gas",
      "exploration",
      "offshore",
    ])
  )
    return "theme-industry-pill-energy";
  if (hit(["energy"])) return "theme-industry-pill-energy";
  if (hit(["semiconductor", "semi ", "semis", "chip", "software", "technology", "internet", "cloud ", "cyber", "saas", "hardware", "data center", "it services", "enterprise soft"]))
    return "theme-industry-pill-tech";
  if (hit(["telecom", "media", "entertainment", "wireless", "cable tv", "streaming", "broadcast", "communications", "advertising", "publishing"]))
    return "theme-industry-pill-communication";
  if (hit(["retail", "apparel", "restaurant", "hotel", "leisure", "travel", "casino", "gaming", "automotive", "auto ", "luxury good", "consumer cyclical", "e-commerce", "ecommerce", "airline"]))
    return "theme-industry-pill-consumer";
  if (hit(["staple", "food ", "beverage", "tobacco", "grocery", "supermarket", "household", "personal care", "packaged food", "distiller"]))
    return "theme-industry-pill-staples";
  if (hit(["aerospace", "defense", "machinery", "industrial", "railroad", "trucking", "construction", "engineering", "building product", "waste manag", "electrical equip"]))
    return "theme-industry-pill-industrial";
  if (hit(["chemical", "mining", "steel", "material", "packaging", "paper", "forest", "agricultur", "fertil", "copper", "lumber", "building material", "gold mine"]))
    return "theme-industry-pill-materials";

  return "theme-industry-pill-neutral";
}
