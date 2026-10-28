/** A starter set of countries with their dialing code and how numbers are grouped there. */
export type Country = { code: string; name: string; dial: string; mask: string };

export const countries: Country[] = [
  { code: "US", name: "United States", dial: "1", mask: "(###) ###-####" },
  { code: "CA", name: "Canada", dial: "1", mask: "(###) ###-####" },
  { code: "GB", name: "United Kingdom", dial: "44", mask: "#### ######" },
  { code: "DE", name: "Germany", dial: "49", mask: "### ########" },
  { code: "FR", name: "France", dial: "33", mask: "# ## ## ## ##" },
  { code: "NL", name: "Netherlands", dial: "31", mask: "# ########" },
  { code: "ES", name: "Spain", dial: "34", mask: "### ### ###" },
  { code: "IT", name: "Italy", dial: "39", mask: "### ### ####" },
  { code: "SE", name: "Sweden", dial: "46", mask: "##-### ## ##" },
  { code: "ID", name: "Indonesia", dial: "62", mask: "###-####-#####" },
  { code: "SG", name: "Singapore", dial: "65", mask: "#### ####" },
  { code: "MY", name: "Malaysia", dial: "60", mask: "##-### ####" },
  { code: "JP", name: "Japan", dial: "81", mask: "##-####-####" },
  { code: "KR", name: "South Korea", dial: "82", mask: "##-####-####" },
  { code: "IN", name: "India", dial: "91", mask: "#####-#####" },
  { code: "AU", name: "Australia", dial: "61", mask: "### ### ###" },
  { code: "BR", name: "Brazil", dial: "55", mask: "(##) #####-####" },
  { code: "MX", name: "Mexico", dial: "52", mask: "## #### ####" },
  { code: "AE", name: "United Arab Emirates", dial: "971", mask: "## ### ####" },
  { code: "ZA", name: "South Africa", dial: "27", mask: "## ### ####" },
];
