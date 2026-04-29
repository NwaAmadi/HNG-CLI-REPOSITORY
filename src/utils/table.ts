export const printTable = (rows: Array<Record<string, string>>) => {
  if (rows.length === 0) {
    console.log("No data");
    return;
  }

  const headers = Object.keys(rows[0] ?? {});
  const widths = headers.map((header) =>
    Math.max(
      header.length,
      ...rows.map((row) => (row[header] ?? "").length),
    ),
  );

  const formatRow = (row: Record<string, string>) =>
    headers
      .map((header, index) => padRight(row[header] ?? "", widths[index]))
      .join("  ");

  console.log(
    headers.map((header, index) => padRight(header, widths[index])).join("  "),
  );
  console.log(widths.map((width) => "-".repeat(width)).join("  "));

  for (const row of rows) {
    console.log(formatRow(row));
  }
};

const padRight = (value: string, width: number) =>
  value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
