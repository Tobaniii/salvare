export function getCandidateCodesForDomain(domain: string): string[] {
  const couponMap: Record<string, string[]> = {
    localhost: ["SAVE10", "TAKE15", "FREESHIP"],
    "www.wonderbly.com": ["WELCOME10", "SAVE15", "FREESHIP"],
  };

  return couponMap[domain] ?? [];
}