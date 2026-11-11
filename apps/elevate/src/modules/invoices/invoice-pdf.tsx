import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { latin } from "@/modules/privacy/pdf";
import { LOGO_ASPECT, LOGO_PNG_DATA_URI } from "@/modules/signing/brand-logo";
import type { InvoiceText } from "./invoice-text";

// The invoice as a PDF (A4), drawn from the same invoiceText as the page. Standard Helvetica (Latin-1 only: other characters become "?").

const PURPLE = "#6C1ABA";
const GOLD = "#E2BE2B";
const INK = "#1f1b2d";
const MUTED = "#6b6680";
const SOFT = "#f3effb";
const LOGO_WIDTH = 30;

const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 54, paddingHorizontal: 44, fontFamily: "Helvetica", fontSize: 9.5, lineHeight: 1.3, color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderBottomColor: PURPLE, paddingBottom: 8, marginBottom: 10 },
  brand: { flexDirection: "row", alignItems: "center" },
  logo: { width: LOGO_WIDTH, height: LOGO_WIDTH / LOGO_ASPECT, marginRight: 8 },
  brandText: { fontFamily: "Helvetica-Bold", fontSize: 13, color: PURPLE },
  titleBlock: { alignItems: "flex-end" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 15, letterSpacing: 0.6, marginBottom: 3 },
  number: { fontSize: 9, color: MUTED },
  draft: { borderWidth: 1, borderColor: GOLD, backgroundColor: "#fbf3d0", padding: 6, marginBottom: 8, fontFamily: "Helvetica-Bold", fontSize: 9 },
  facts: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  fact: { width: "25%", marginBottom: 5, paddingRight: 6 },
  factLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  factValue: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  tableHead: { flexDirection: "row", backgroundColor: SOFT, borderBottomWidth: 0.8, borderBottomColor: INK, paddingVertical: 4, paddingHorizontal: 6, fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  row: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 6, borderBottomWidth: 0.4, borderBottomColor: "#d9d3e8" },
  totalRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 6, borderTopWidth: 0.8, borderTopColor: INK, backgroundColor: SOFT, fontFamily: "Helvetica-Bold" },
  cPerson: { flex: 1, paddingRight: 6 },
  cNum: { width: 80, textAlign: "right" },
  totalBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1.5, borderColor: PURPLE, paddingVertical: 8, paddingHorizontal: 10, marginTop: 14, borderRadius: 3 },
  note: { marginTop: 10, fontSize: 8.5, color: INK },
  small: { marginTop: 8, fontSize: 8, color: MUTED },
  accent: { height: 3, width: 40, backgroundColor: GOLD, marginTop: 10 },
  footer: { position: "absolute", bottom: 20, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
});

function InvoicePdfDocument({ view }: { view: InvoiceText }) {
  return (
    <Document title={latin(`Invoice ${view.number}`)} author="Elite Resource Services" creator="ELEVATE" producer="ELEVATE">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <Image src={LOGO_PNG_DATA_URI} style={styles.logo} />
            <Text style={styles.brandText}>Elite Resource Services</Text>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>INVOICE</Text>
            <Text style={styles.number}>{latin(view.number)}</Text>
          </View>
        </View>

        {view.isDraft ? <Text style={styles.draft}>{latin(view.draftNote)}</Text> : null}

        <View style={styles.facts}>
          {[
            ["Bill to", view.clientName],
            ["Period", view.period],
            ["Date", view.issuedOn],
            ["Rate per hour", `${view.rate} ${view.currency}`],
          ].map(([label, value]) => (
            <View key={label} style={styles.fact}>
              <Text style={styles.factLabel}>{label}</Text>
              <Text style={styles.factValue}>{latin(value)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.tableHead} fixed>
          <Text style={styles.cPerson}>PERSON</Text>
          <Text style={styles.cNum}>HOURS</Text>
          <Text style={styles.cNum}>RATE ({view.currency})</Text>
          <Text style={styles.cNum}>AMOUNT ({view.currency})</Text>
        </View>
        {view.lines.map((l, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={styles.cPerson}>{latin(l.name)}</Text>
            <Text style={styles.cNum}>{l.hours}</Text>
            <Text style={styles.cNum}>{l.rate}</Text>
            <Text style={styles.cNum}>{l.amount}</Text>
          </View>
        ))}
        <View style={styles.totalRow} wrap={false}>
          <Text style={styles.cPerson}>Total</Text>
          <Text style={styles.cNum}>{view.totalHours}</Text>
          <Text style={styles.cNum} />
          <Text style={styles.cNum}>{view.total}</Text>
        </View>

        <View style={styles.totalBox} wrap={false}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Total due ({view.currency})</Text>
          <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 14 }}>{view.total}</Text>
        </View>

        {view.unconfirmed ? <Text style={styles.note}>{latin(view.unconfirmed)}</Text> : null}
        <Text style={styles.small}>All amounts are in US dollars ({view.currency}). Hours are the client payroll hours of the pay run for the period.</Text>
        <View style={styles.accent} />

        <View style={styles.footer} fixed>
          <Text>Elite Resource Services</Text>
          <Text render={({ pageNumber, totalPages }) => `${latin(view.number)}  -  Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(view: InvoiceText): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<InvoicePdfDocument view={view} />);
  return new Uint8Array(buffer);
}
