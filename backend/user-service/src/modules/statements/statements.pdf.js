const { PdfDocument, PAGE } = require("../../utils/pdf");

const COLUMNS = [
  { key: "date", label: "Date", width: 78, align: "left" },
  { key: "reference", label: "Reference", width: 128, align: "left" },
  { key: "type", label: "Type", width: 80, align: "left" },
  { key: "status", label: "Status", width: 64, align: "left" },
  { key: "amount", label: "Amount", width: 72, align: "right" },
  { key: "balance", label: "Balance", width: 77, align: "right" },
];

const COLORS = {
  ink: [0.09, 0.12, 0.18],
  muted: [0.42, 0.46, 0.53],
  brand: [0.05, 0.27, 0.55],
  headerFill: [0.93, 0.95, 0.98],
  rowFill: [0.97, 0.98, 0.99],
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const formatDate = (value) => dateFormatter.format(new Date(value));

const columnX = (index) =>
  COLUMNS.slice(0, index).reduce((total, column) => total + column.width, PAGE.margin);

const drawTableHeader = (doc) => {
  doc.rect({ y: doc.y - 4, height: 20, color: COLORS.headerFill });
  COLUMNS.forEach((column, index) => {
    doc.text(column.label, {
      x: columnX(index),
      y: doc.y,
      size: 8.5,
      bold: true,
      color: COLORS.muted,
      align: column.align,
      maxWidth: column.width,
    });
  });
  doc.y -= 20;
};

const drawRow = (doc, row, index) => {
  if (index % 2 === 1) {
    doc.rect({ y: doc.y - 5, height: 18, color: COLORS.rowFill });
  }
  COLUMNS.forEach((column, columnIndex) => {
    doc.text(row[column.key], {
      x: columnX(columnIndex),
      y: doc.y,
      size: 8.5,
      align: column.align,
      maxWidth: column.width,
    });
  });
  doc.y -= 18;
};

const drawSummary = (doc, statement) => {
  const items = [
    ["Opening balance", statement.openingBalance],
    ["Total incoming", statement.totals.incoming],
    ["Total outgoing", statement.totals.outgoing],
    ["Closing balance", statement.closingBalance],
  ];
  const gap = 10;
  const boxWidth = (doc.width - gap * (items.length - 1)) / items.length;
  const startY = doc.y;
  items.forEach(([label, value], index) => {
    const x = doc.left + index * (boxWidth + gap);
    doc.rect({ x, y: startY - 40, width: boxWidth, height: 42, color: COLORS.headerFill });
    doc.text(label, {
      x: x + 8,
      y: startY - 10,
      size: 8,
      color: COLORS.muted,
      maxWidth: boxWidth - 16,
    });
    doc.text(`${statement.account.currency} ${value}`, {
      x: x + 8,
      y: startY - 28,
      size: 12,
      bold: true,
      maxWidth: boxWidth - 16,
    });
  });
  doc.y = startY - 52;
};

const buildStatementPdf = (statement) => {
  const doc = new PdfDocument({
    title: `Statement ${statement.period.from} to ${statement.period.to}`,
  });

  doc.text("Meridian Bank", { size: 18, bold: true, color: COLORS.brand });
  doc.y -= 20;
  doc.text("Account statement", { size: 12, color: COLORS.ink });
  doc.text(`Generated ${timestampFormatter.format(new Date())} UTC`, {
    size: 8,
    color: COLORS.muted,
    align: "right",
    y: PAGE.height - PAGE.margin - 4,
  });
  doc.y -= 16;
  doc.rule();
  doc.y -= 18;

  const details = [
    ["Account holder", statement.account.holder],
    ["Email", statement.account.email || "-"],
    ["Account number", statement.account.walletId],
    ["Statement period", `${statement.period.from} to ${statement.period.to} (UTC)`],
    ["Transactions", String(statement.totals.transactions)],
  ];
  details.forEach(([label, value]) => {
    doc.text(`${label}: ${value}`, { size: 9, maxWidth: doc.width });
    doc.y -= 14;
  });

  doc.y -= 8;
  drawSummary(doc, statement);
  doc.y -= 6;
  drawTableHeader(doc);

  if (statement.transactions.length === 0) {
    doc.moveDown(8);
    doc.text("No transactions in this period.", { size: 9, color: COLORS.muted });
  }

  statement.transactions.forEach((row, index) => {
    if (!doc.hasSpace(40)) {
      doc.newPage();
      doc.y -= 0;
      drawTableHeader(doc);
    }
    drawRow(
      doc,
      {
        date: formatDate(row.createdAt),
        reference: row.reference,
        type: row.type.replace(/_/g, " "),
        status: row.status,
        amount: `${row.direction === "OUTGOING" ? "-" : "+"}${row.currency} ${row.amount}`,
        balance: `${row.currency} ${row.balanceAfter}`,
      },
      index
    );
  });

  doc.stampFooter(
    (page, total) =>
      `Meridian Bank - Confidential - Account statement ${statement.period.from} to ${statement.period.to} - Page ${page} of ${total}`
  );

  return doc.build();
};

module.exports = { buildStatementPdf };
