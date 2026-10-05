export const RAIN_LEGEND = [
  { value: 0, label: "0" },
  { value: 0.5, label: "<1" },
  { value: 2, label: "1–5" },
  { value: 8, label: "5–15" },
  { value: 20, label: "15–30" },
  { value: 45, label: "30–60" },
  { value: 60, label: "60+" },
];
export function rainColor(mm: number): string {
  return mm === 0
    ? "#eaf4f1"
    : mm < 1
      ? "#8fc6ba"
      : mm < 5
        ? "#459b8b"
        : mm < 15
          ? "#257261"
          : mm < 30
            ? "#23546f"
            : mm < 60
              ? "#583e83"
              : "#35234f";
}
