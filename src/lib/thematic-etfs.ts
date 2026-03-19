export type ThematicEtfItem = {
  id: string;
  category: string;
  theme: string;
  ticker: string;
};

export const THEMATIC_ETFS: ThematicEtfItem[] = [
  { id: "ai-robotics", category: "Technology & Innovation", theme: "AI & robotics", ticker: "BOTZ" },
  { id: "semiconductors", category: "Technology & Innovation", theme: "Semiconductors", ticker: "SMH" },
  { id: "cloud-computing", category: "Technology & Innovation", theme: "Cloud computing", ticker: "SKYY" },
  { id: "cybersecurity", category: "Technology & Innovation", theme: "Cybersecurity", ticker: "CIBR" },
  { id: "data-centers-ai-infrastructure", category: "Technology & Innovation", theme: "Data centers & AI infrastructure", ticker: "DTCR" },
  { id: "iot", category: "Technology & Innovation", theme: "Internet of Things (IoT)", ticker: "SNSR" },
  { id: "quantum-computing", category: "Technology & Innovation", theme: "Quantum computing", ticker: "QTUM" },
  { id: "space-exploration", category: "Technology & Innovation", theme: "Space exploration", ticker: "ARKX" },
  { id: "broad-disruptive-innovation", category: "Technology & Innovation", theme: "Broad disruptive innovation", ticker: "ARKK" },
  { id: "oil-gas-ep", category: "Energy & Environment", theme: "Oil & gas E&P", ticker: "XOP" },
  { id: "clean-energy-broad", category: "Energy & Environment", theme: "Clean energy (broad)", ticker: "ICLN" },
  { id: "solar", category: "Energy & Environment", theme: "Solar", ticker: "TAN" },
  { id: "nuclear-uranium", category: "Energy & Environment", theme: "Nuclear & uranium", ticker: "URA" },
  { id: "hydrogen", category: "Energy & Environment", theme: "Hydrogen", ticker: "HYDR" },
  { id: "water", category: "Energy & Environment", theme: "Water", ticker: "PHO" },
  { id: "ev-battery-technology", category: "Mobility & Industrials", theme: "EV & battery technology", ticker: "LIT" },
  { id: "infrastructure-reshoring", category: "Mobility & Industrials", theme: "Infrastructure & reshoring", ticker: "PAVE" },
  { id: "defence-aerospace", category: "Mobility & Industrials", theme: "Defence & aerospace", ticker: "ITA" },
  { id: "smart-grid-electrification", category: "Mobility & Industrials", theme: "Smart grid & electrification", ticker: "GRID" },
  { id: "gold-miners", category: "Resources & Materials", theme: "Gold miners", ticker: "GDX" },
  { id: "silver-miners", category: "Resources & Materials", theme: "Silver miners", ticker: "SIL" },
  { id: "copper", category: "Resources & Materials", theme: "Copper", ticker: "COPX" },
  { id: "rare-earth-critical-minerals", category: "Resources & Materials", theme: "Rare earth & critical minerals", ticker: "REMX" },
  { id: "agribusiness-food-tech", category: "Resources & Materials", theme: "Agribusiness & food tech", ticker: "MOO" },
  { id: "bitcoin", category: "Finance & Digital Assets", theme: "Bitcoin", ticker: "IBIT" },
  { id: "blockchain-broad", category: "Finance & Digital Assets", theme: "Blockchain (broad)", ticker: "BLOK" },
  { id: "fintech-payments", category: "Finance & Digital Assets", theme: "Fintech & payments", ticker: "FINX" },
  { id: "biotech-genomics", category: "Healthcare & Life Sciences", theme: "Biotech & genomics", ticker: "XBI" },
  { id: "glp1-obesity-drugs", category: "Healthcare & Life Sciences", theme: "GLP-1 & obesity drugs", ticker: "OZEM" },
  { id: "cannabis", category: "Consumer & Lifestyle", theme: "Cannabis", ticker: "MSOS" },
  { id: "sports-betting-igaming", category: "Consumer & Lifestyle", theme: "Sports betting & iGaming", ticker: "BETZ" },
  { id: "video-games-esports", category: "Consumer & Lifestyle", theme: "Video games & esports", ticker: "ESPO" },
  { id: "homebuilders-housing", category: "Consumer & Lifestyle", theme: "Homebuilders & housing", ticker: "ITB" },
  { id: "travel-airlines", category: "Consumer & Lifestyle", theme: "Travel & airlines", ticker: "JETS" },
  { id: "social-media", category: "Consumer & Lifestyle", theme: "Social media", ticker: "SOCL" },
  { id: "ecommerce", category: "Consumer & Lifestyle", theme: "E-commerce", ticker: "IBUY" },
  { id: "china-internet-tech", category: "International", theme: "China internet & tech", ticker: "KWEB" },
  { id: "india", category: "International", theme: "India", ticker: "INDA" },
];
