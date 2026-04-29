export const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2));
};

export const toCsv = (rows: unknown[]) => {
  if (rows.length === 0) {
    return "";
  }

  const normalized = rows.map((row) =>
    row && typeof row === "object" && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : { value: row },
  );
  const headers = Array.from(
    new Set(normalized.flatMap((row) => Object.keys(row))),
  );
  const lines = [
    headers.join(","),
    ...normalized.map((row) =>
      headers.map((header) => escapeCsvCell(row[header])).join(","),
    ),
  ];

  return `${lines.join("\n")}\n`;
};

const escapeCsvCell = (value: unknown) => {
  const rendered =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  if (/[",\n]/.test(rendered)) {
    return `"${rendered.replaceAll('"', '""')}"`;
  }

  return rendered;
};
