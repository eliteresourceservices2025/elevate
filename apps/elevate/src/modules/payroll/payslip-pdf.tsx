import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { latin } from "@/modules/privacy/pdf";
import { LOGO_ASPECT, LOGO_PNG_DATA_URI } from "@/modules/signing/brand-logo";
import { PAYSLIP_LABELS as L } from "./constants";
import type { PayslipLineView, PayslipRowView, PayslipView } from "./payslip";

// The payslip as a PDF (A4), drawn from the same payslipView as the page. Standard Helvetica (Latin-1 only: other characters become "?"),
// so a payslip never fails to draw. The signature picture is a JPEG kept with the run.

const PURPLE = "#6C1ABA";
const GOLD = "#E2BE2B";
const INK = "#1f1b2d";
const MUTED = "#6b6680";
const SOFT = "#f3effb";
const LOGO_WIDTH = 30;

const styles = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 70, paddingHorizontal: 48, fontFamily: "Helvetica", fontSize: 10, lineHeight: 1.4, color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderBottomColor: PURPLE, paddingBottom: 10, marginBottom: 16 },
  brand: { flexDirection: "row", alignItems: "center" },
  logo: { width: LOGO_WIDTH, height: LOGO_WIDTH / LOGO_ASPECT, marginRight: 8 },
  brandText: { fontFamily: "Helvetica-Bold", fontSize: 13, color: PURPLE },
  titleBlock: { alignItems: "flex-end" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 18, letterSpacing: 1.2, lineHeight: 1.2, marginBottom: 4 },
  number: { fontSize: 8.5, color: MUTED },
  facts: { flexDirection: "row", flexWrap: "wrap", marginBottom: 14 },
  fact: { width: "50%", marginBottom: 8 },
  factLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  factValue: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  lineHeading: { fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 6, marginBottom: 6 },
  tableHead: { flexDirection: "row", backgroundColor: SOFT, paddingVertical: 4, paddingHorizontal: 6, marginTop: 4 },
  headText: { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: PURPLE },
  row: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: "#e6e1f0" },
  colLabel: { flex: 3 },
  colDetail: { flex: 3, color: MUTED, fontSize: 9 },
  colAmount: { flex: 2, textAlign: "right" },
  grossRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: PURPLE, backgroundColor: SOFT, marginBottom: 6 },
  bold: { fontFamily: "Helvetica-Bold" },
  sectionTitle: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 },
  netBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: PURPLE, color: "#ffffff", paddingVertical: 8, paddingHorizontal: 10, marginTop: 8, borderRadius: 3 },
  netLabel: { fontFamily: "Helvetica-Bold", fontSize: 11, color: "#ffffff" },
  netAmount: { fontFamily: "Helvetica-Bold", fontSize: 16, color: "#ffffff" },
  totalBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1.5, borderColor: PURPLE, paddingVertical: 8, paddingHorizontal: 10, marginTop: 14, borderRadius: 3 },
  signature: { marginTop: 30, width: 200 },
  signLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  signSpace: { height: 46, justifyContent: "flex-end", borderBottomWidth: 0.8, borderBottomColor: INK, paddingBottom: 2 },
  signImage: { height: 42, objectFit: "contain", objectPositionX: 0 },
  signName: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 4 },
  signMuted: { fontSize: 9, color: MUTED },
  notSigned: { fontSize: 10, fontFamily: "Helvetica-Oblique", color: MUTED, marginTop: 4 },
  accent: { height: 3, width: 40, backgroundColor: GOLD, marginTop: 14 },
  footer: { position: "absolute", bottom: 28, left: 48, right: 48, fontSize: 8, color: MUTED, flexDirection: "row", justifyContent: "space-between" },
});

function Rows({ rows }: { rows: PayslipRowView[] }) {
  return (
    <>
      {rows.map((row) => (
        <View key={`${row.label}-${row.detail}`} style={styles.row} wrap={false}>
          <Text style={styles.colLabel}>{latin(row.label)}</Text>
          <Text style={styles.colDetail}>{latin(row.detail)}</Text>
          <Text style={styles.colAmount}>{row.amount}</Text>
        </View>
      ))}
    </>
  );
}

function Head() {
  return (
    <View style={styles.tableHead}>
      <Text style={[styles.headText, styles.colLabel]}>{L.earnings}</Text>
      <Text style={[styles.headText, styles.colDetail]}>{L.detailColumn}</Text>
      <Text style={[styles.headText, styles.colAmount]}>{L.amountColumn}</Text>
    </View>
  );
}

function Line({ line }: { line: PayslipLineView }) {
  return (
    <View>
      {line.heading ? <Text style={styles.lineHeading}>{latin(line.heading)}</Text> : null}
      <Head />
      <Rows rows={line.earnings} />
      <View style={styles.grossRow} wrap={false}>
        <Text style={[styles.colLabel, styles.bold]}>{L.gross}</Text>
        <Text style={styles.colDetail} />
        <Text style={[styles.colAmount, styles.bold]}>{line.gross}</Text>
      </View>
      {line.additions.length > 0 ? (
        <View>
          <Text style={styles.sectionTitle}>{L.additions}</Text>
          <Rows rows={line.additions} />
        </View>
      ) : null}
      {line.deductions.length > 0 ? (
        <View>
          <Text style={styles.sectionTitle}>{L.deductions}</Text>
          <Rows rows={line.deductions} />
        </View>
      ) : null}
      <View style={styles.netBox} wrap={false}>
        <Text style={styles.netLabel}>{L.net}</Text>
        <Text style={styles.netAmount}>{line.net}</Text>
      </View>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{latin(value)}</Text>
    </View>
  );
}

function PayslipDocument({ view }: { view: PayslipView }) {
  const signature = view.signature;
  return (
    <Document title={latin(`${view.title} ${view.period}`)} author="Elite Resource Services" creator="ELEVATE" producer="ELEVATE">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <Image src={LOGO_PNG_DATA_URI} style={styles.logo} />
            <Text style={styles.brandText}>Elite Resource Services</Text>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{latin(view.title.toUpperCase())}</Text>
            <Text style={styles.number}>
              {L.number} {latin(view.number)}
            </Text>
          </View>
        </View>

        <View style={styles.facts}>
          <Fact label={L.preparedFor} value={view.name} />
          <Fact label={L.period} value={view.period} />
          {view.paidOn ? <Fact label={L.paidOn} value={view.paidOn} /> : null}
          {view.paidBy ? <Fact label={L.paidBy} value={view.paidBy} /> : null}
        </View>

        {view.lines.map((line, index) => (
          <Line key={index} line={line} />
        ))}

        {view.total ? (
          <View style={styles.totalBox} wrap={false}>
            <Text style={styles.bold}>{L.total}</Text>
            <Text style={[styles.bold, { fontSize: 14 }]}>{view.total}</Text>
          </View>
        ) : null}

        <View style={styles.signature} wrap={false}>
          <Text style={styles.signLabel}>{L.signedBy}</Text>
          <View style={styles.signSpace}>
            {signature?.imageBase64 ? <Image src={{ data: Buffer.from(signature.imageBase64, "base64"), format: "jpg" }} style={styles.signImage} /> : null}
          </View>
          {signature ? (
            <>
              <Text style={styles.signName}>{latin(signature.name)}</Text>
              <Text style={{ fontSize: 10 }}>{latin(signature.title)}</Text>
              <Text style={styles.signMuted}>
                {L.signedOn} {signature.signedOn}
              </Text>
            </>
          ) : (
            <Text style={styles.notSigned}>{L.notSigned}</Text>
          )}
        </View>
        <View style={styles.accent} />

        <View style={styles.footer} fixed>
          <Text>
            {latin(L.footerNote)}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${latin(view.number)}  |  Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

async function draw(view: PayslipView): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<PayslipDocument view={view} />);
  return new Uint8Array(buffer);
}

export async function renderPayslipPdf(view: PayslipView): Promise<Uint8Array> {
  try {
    return await draw(view);
  } catch (error) {
    // A picture that passed the structure check when it was saved but cannot be drawn must not block everyone's payslip: draw it without
    // the picture (the name, title and date still print). Only the kind of error is logged.
    if (!view.signature?.imageBase64) throw error;
    console.error("payroll payslip signature picture could not be drawn:", { error: error instanceof Error ? error.name : "UnknownError" });
    return draw({ ...view, signature: { ...view.signature, imageBase64: null } });
  }
}
