import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { latin } from "@/modules/privacy/pdf";
import { LOGO_ASPECT, LOGO_PNG_DATA_URI } from "@/modules/signing/brand-logo";
import { PAYSLIP_LABELS as L } from "./constants";
import type { PayslipLineView, PayslipRowView, PayslipView } from "./payslip";

// The Contractor Payment Statement as a PDF (A4), drawn from the same payslipView as the page. Standard Helvetica (Latin-1 only: other characters become "?"),
// so a payslip never fails to draw. The signature picture is a JPEG kept with the run.

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
  test: { borderWidth: 2, borderColor: "#b42318", backgroundColor: "#fde8e6", color: "#7a1710", padding: 6, marginBottom: 8, fontFamily: "Helvetica-Bold", fontSize: 10 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 13, letterSpacing: 0.6, lineHeight: 1.2, marginBottom: 4 },
  number: { fontSize: 8.5, color: MUTED },
  facts: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  fact: { width: "33.33%", marginBottom: 5 },
  factLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  factValue: { fontFamily: "Helvetica-Bold", fontSize: 10.5 },
  lineHeading: { fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 6, marginBottom: 6 },
  sectionTitle: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8, marginBottom: 3 },
  compBox: { flexDirection: "row", borderWidth: 0.8, borderColor: INK, marginTop: 8 },
  compCol: { width: "50%" },
  compColRight: { borderLeftWidth: 0.8, borderLeftColor: INK },
  colHead: { backgroundColor: SOFT, paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 0.8, borderBottomColor: INK, fontFamily: "Helvetica-Bold", fontSize: 8.5, textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, paddingHorizontal: 6, borderBottomWidth: 0.4, borderBottomColor: "#d9d3e8" },
  rowLabel: { flex: 1, paddingRight: 6 },
  rowDetail: { fontSize: 7.5, color: MUTED },
  rowAmount: { width: 70, textAlign: "right" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, paddingHorizontal: 6, borderTopWidth: 0.8, borderTopColor: INK, backgroundColor: SOFT, fontFamily: "Helvetica-Bold" },
  miniRow: { flexDirection: "row", marginBottom: 2 },
  mini: { width: "25%" },
  miniLabel: { fontSize: 7.5, color: MUTED },
  bold: { fontFamily: "Helvetica-Bold" },
  certTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  certText: { fontSize: 7.5, color: MUTED, lineHeight: 1.3 },
  netBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: PURPLE, color: "#ffffff", paddingVertical: 8, paddingHorizontal: 10, marginTop: 8, borderRadius: 3 },
  netLabel: { fontFamily: "Helvetica-Bold", fontSize: 11, color: "#ffffff" },
  netAmount: { fontFamily: "Helvetica-Bold", fontSize: 16, color: "#ffffff" },
  totalBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1.5, borderColor: PURPLE, paddingVertical: 8, paddingHorizontal: 10, marginTop: 14, borderRadius: 3 },
  signature: { marginTop: 14, width: 200 },
  signLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  signSpace: { height: 38, justifyContent: "flex-end", borderBottomWidth: 0.8, borderBottomColor: INK, paddingBottom: 2 },
  signImage: { height: 34, objectFit: "contain", objectPositionX: 0 },
  signName: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 4 },
  signMuted: { fontSize: 9, color: MUTED },
  notSigned: { fontSize: 10, fontFamily: "Helvetica-Oblique", color: MUTED, marginTop: 4 },
  accent: { height: 3, width: 40, backgroundColor: GOLD, marginTop: 8 },
  footer: { position: "absolute", bottom: 20, left: 44, right: 44, fontSize: 7.5, color: MUTED },
});

function Column({ title, rows, totalLabel, total, right }: { title: string; rows: PayslipRowView[]; totalLabel: string; total: string; right?: boolean }) {
  return (
    <View style={right ? [styles.compCol, styles.compColRight] : styles.compCol}>
      <Text style={styles.colHead}>{title}</Text>
      {rows.map((row, index) => (
        <View key={`${row.label}-${index}`} style={styles.row} wrap={false}>
          <Text style={styles.rowLabel}>
            {latin(row.label)}
            {row.detail ? <Text style={styles.rowDetail}>{`  ${latin(row.detail)}`}</Text> : null}
          </Text>
          <Text style={styles.rowAmount}>{row.amount}</Text>
        </View>
      ))}
      <View style={{ flexGrow: 1 }} />
      <View style={styles.totalRow}>
        <Text>{totalLabel}</Text>
        <Text>{total}</Text>
      </View>
    </View>
  );
}

function Mini({ rows, width }: { rows: PayslipRowView[]; width?: string }) {
  return (
    <View style={styles.miniRow}>
      {rows.map((row) => (
        <View key={row.label} style={width ? [styles.mini, { width }] : styles.mini}>
          <Text style={styles.miniLabel}>{latin(row.label)}</Text>
          <Text>{row.amount}</Text>
        </View>
      ))}
    </View>
  );
}

function Line({ line }: { line: PayslipLineView }) {
  return (
    <View>
      {line.heading ? <Text style={styles.lineHeading}>{latin(line.heading)}</Text> : null}
      {line.client ? <Text style={{ marginBottom: 4 }}>{L.client}: {latin(line.client)}</Text> : null}
      <Text style={styles.sectionTitle}>{L.computationTitle}</Text>
      <Mini rows={line.computation} />
      <View style={styles.compBox} wrap={false}>
        <Column title={L.compensationTitle} rows={line.compensation} totalLabel={L.totalCompensation} total={line.totalCompensation} />
        <Column title={L.deductionsTitle} rows={line.deductions} totalLabel={L.totalDeductions} total={line.totalDeductions} right />
      </View>
      <Text style={styles.sectionTitle}>{L.leaveTitle}</Text>
      <Mini rows={line.leave} width="33%" />
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

        {view.isTest ? <Text style={styles.test}>{latin(L.testNote)}</Text> : null}

        <View style={styles.facts}>
          <Fact label={L.preparedFor} value={view.name} />
          <Fact label={L.period} value={view.period} />
          {view.hiredOn ? <Fact label={L.hiredOn} value={view.hiredOn} /> : null}
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

        <View style={{ marginTop: 10 }} wrap={false}>
          <Text style={styles.certTitle}>{L.certificationTitle}</Text>
          <Text style={styles.certText}>{latin(L.certificationText)}</Text>
          <View style={{ flexDirection: "row", marginTop: 6, alignItems: "flex-end" }}>
            <View style={{ width: "34%", marginRight: "2%" }}>
              <Text style={styles.signLabel}>{L.signedBy}</Text>
              <View style={styles.signSpace}>
                {signature?.imageBase64 ? <Image src={{ data: Buffer.from(signature.imageBase64, "base64"), format: "jpg" }} style={styles.signImage} /> : null}
              </View>
              {signature ? (
                <>
                  <Text style={styles.signName}>{latin(signature.name)}</Text>
                  <Text style={{ fontSize: 8.5 }}>{latin(signature.title)}</Text>
                  <Text style={styles.signMuted}>
                    {L.signedOn} {signature.signedOn}
                  </Text>
                </>
              ) : (
                <Text style={styles.notSigned}>{L.notSigned}</Text>
              )}
            </View>
            {[
              [L.preparedBy, "22%"],
              [L.certDate, "16%"],
              [L.contractorSignature, "24%"],
            ].map(([label, width]) => (
              <View key={label} style={{ width, marginRight: "2%", alignSelf: "flex-start" }}>
                <Text style={styles.signLabel}> </Text>
                <View style={{ borderBottomWidth: 0.8, borderBottomColor: INK, height: 38 }} />
                <Text style={[styles.miniLabel, { marginTop: 4 }]}>{latin(label)}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.certTitle, { marginTop: 8 }]}>{L.disclaimerTitle}</Text>
          <Text style={styles.certText}>{latin(L.disclaimerText)}</Text>
        </View>
        <View style={{ marginTop: 8, fontSize: 7.5, color: MUTED }} wrap={false}>
          <Text style={{ marginBottom: 3 }}>{latin(L.noTax)}</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text>{latin(L.footerNote)}</Text>
            <Text>{latin(view.number)}</Text>
          </View>
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
