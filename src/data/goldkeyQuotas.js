/** 간호사 이름 → 골드키 총 할당(시드·DB ensure·오프라인 샘플 공통). 미지정은 10. */
const NURSE_GOLDKEY_QUOTA_BY_NAME = {
  임희종: 15,
  이양희: 15,
  허정숙: 15,
  이현숙: 15,
  유진: 14,
  김해림: 13,
  양현아: 13,
  장지은: 13,
  오민아: 12,
  손다솜: 12,
  최종선: 11,
  장성필: 11,
  이지선: 11,
  최유리: 11,
  최유경: 11,
  정수영: 4,
};

export function defaultGoldkeyQuotaForName(name) {
  const n = String(name ?? "").trim();
  return NURSE_GOLDKEY_QUOTA_BY_NAME[n] ?? 10;
}
