/** 수술실·마취과 간호사 이름 → 골드키 총 할당(시드·DB ensure·오프라인 샘플 공통). 미지정은 10. */
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
  김인자: 15,
  이지현: 15,
  박현정: 15,
  윤지민: 12,
};

export function defaultGoldkeyQuotaForName(name) {
  const n = String(name ?? "").trim();
  return NURSE_GOLDKEY_QUOTA_BY_NAME[n] ?? 10;
}

/** 마취과 간호사만 (표시·검증용) */
export const ANESTHESIA_GOLDKEY_NAMES = ["김인자", "박현정", "이지현", "윤지민"];
