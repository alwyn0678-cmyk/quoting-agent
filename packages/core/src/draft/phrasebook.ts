/**
 * Every customer-visible word of a quote draft, per language. Reviewed, code-owned text: the model only
 * CHOOSES language, formality, intro and closing; it never writes customer-facing prose. Placeholders
 * in braces are filled by code with sanitised, canonical values. Translations are an ASSUMPTION until a
 * native speaker reviews them (ASSUMPTIONS.md H11).
 */
export const LANGUAGES = ["en", "nl", "de", "es", "pt", "zh"] as const;
export type Language = (typeof LANGUAGES)[number];

type Phrases = Record<string, string>;

const en: Phrases = {
  greeting_formal_named: "Dear {name},",
  greeting_formal: "Dear Sir or Madam,",
  greeting_informal_named: "Hello {name},",
  greeting_informal: "Hello,",
  intro_thanks_for_request: "Thank you for your quotation request. Please find our offer below.",
  intro_thanks_for_interest: "Thank you for your interest in our services. Our offer for your shipment is set out below.",
  intro_following_up: "Following up on your enquiry, please find our offer below.",
  closing_questions_welcome: "If you have any questions about this offer, please let us know.",
  closing_look_forward: "We look forward to handling your shipment.",
  closing_book_invite: "To proceed with a booking, simply reply to this email.",
  subject: "Quotation {route}",
  route: "Route", mode: "Mode", cargo: "Cargo", incoterm: "Incoterm", ready: "Cargo ready",
  option: "Option", transit: "approx. {days} days transit", valid_until: "valid until {date}", total: "Total", includes: "Includes",
  fx_note: "{from} amounts converted to {to} at {source} of {date}",
  per_shipment: "per shipment", per_bl: "per B/L",
  assume_general: "Quoted as non-hazardous, non-temperature-controlled general cargo.",
  assume_port: "Port-to-port service; local charges beyond those listed are not included.",
  terms: "All business is subject to our {terms}.",
  ch_BASE: "Base freight", ch_OF: "Ocean freight", ch_BAF: "Bunker adjustment (BAF)", ch_LSS: "Low-sulphur surcharge", ch_EBS: "Emergency bunker surcharge",
  ch_THC: "Terminal handling", ch_THC_O: "Origin terminal handling", ch_THC_D: "Destination terminal handling",
  ch_ISPS: "Port security (ISPS)", ch_DOC: "Documentation", ch_CFS: "CFS handling", ch_PSS: "Peak season surcharge",
  ch_ETS: "EU ETS surcharge", ch_CAF: "Currency adjustment", ch_GRI: "General rate increase", ch_CUSTOMS: "Customs clearance",
  ch_OTHER: "Other surcharge", ch_MARGIN_FLAT: "Service fee", ch_MARGIN_ADJ: "Minimum service charge",
  fx_source_ecb: "ECB reference rates", fx_source_other: "reference rates",
};

const nl: Phrases = {
  greeting_formal_named: "Geachte {name},",
  greeting_formal: "Geachte heer/mevrouw,",
  greeting_informal_named: "Beste {name},",
  greeting_informal: "Goedendag,",
  intro_thanks_for_request: "Hartelijk dank voor uw offerteaanvraag. Hieronder vindt u onze aanbieding.",
  intro_thanks_for_interest: "Dank voor uw interesse in onze diensten. Onze aanbieding voor uw zending staat hieronder.",
  intro_following_up: "Naar aanleiding van uw aanvraag treft u hieronder onze aanbieding aan.",
  closing_questions_welcome: "Heeft u vragen over deze aanbieding, laat het ons dan weten.",
  closing_look_forward: "Wij verzorgen uw zending graag.",
  closing_book_invite: "Wilt u boeken? Beantwoord dan eenvoudig deze e-mail.",
  subject: "Offerte {route}",
  route: "Route", mode: "Modaliteit", cargo: "Lading", incoterm: "Incoterm", ready: "Lading gereed",
  option: "Optie", transit: "ca. {days} dagen transit", valid_until: "geldig tot {date}", total: "Totaal", includes: "Inclusief",
  fx_note: "Bedragen in {from} omgerekend naar {to} tegen {source} van {date}",
  per_shipment: "per zending", per_bl: "per B/L",
  assume_general: "Geoffreerd als niet-gevaarlijke, niet-temperatuurgevoelige stukgoederen.",
  assume_port: "Port-to-port service; lokale kosten buiten de vermelde posten zijn niet inbegrepen.",
  terms: "Op al onze werkzaamheden zijn de {terms} van toepassing.",
  ch_BASE: "Basisvracht", ch_OF: "Zeevracht", ch_BAF: "Bunkertoeslag (BAF)", ch_LSS: "Laagzwaveltoeslag", ch_EBS: "Noodbunkertoeslag",
  ch_THC: "Terminal handling", ch_THC_O: "Terminal handling vertrek", ch_THC_D: "Terminal handling bestemming",
  ch_ISPS: "Havenbeveiliging (ISPS)", ch_DOC: "Documentatie", ch_CFS: "CFS-handling", ch_PSS: "Piekseizoentoeslag",
  ch_ETS: "EU ETS-toeslag", ch_CAF: "Valutatoeslag", ch_GRI: "Algemene tariefverhoging", ch_CUSTOMS: "Douane-inklaring",
  ch_OTHER: "Overige toeslag", ch_MARGIN_FLAT: "Servicekosten", ch_MARGIN_ADJ: "Minimale servicekosten",
  fx_source_ecb: "ECB-referentiekoersen", fx_source_other: "referentiekoersen",
};

const de: Phrases = {
  greeting_formal_named: "Sehr geehrte/r {name},",
  greeting_formal: "Sehr geehrte Damen und Herren,",
  greeting_informal_named: "Hallo {name},",
  greeting_informal: "Hallo,",
  intro_thanks_for_request: "Vielen Dank für Ihre Angebotsanfrage. Unser Angebot finden Sie unten.",
  intro_thanks_for_interest: "Vielen Dank für Ihr Interesse an unseren Leistungen. Unser Angebot für Ihre Sendung finden Sie unten.",
  intro_following_up: "Bezugnehmend auf Ihre Anfrage finden Sie unser Angebot unten.",
  closing_questions_welcome: "Bei Fragen zu diesem Angebot melden Sie sich gerne.",
  closing_look_forward: "Wir freuen uns darauf, Ihre Sendung abzuwickeln.",
  closing_book_invite: "Für eine Buchung antworten Sie einfach auf diese E-Mail.",
  subject: "Angebot {route}",
  route: "Route", mode: "Verkehrsträger", cargo: "Ladung", incoterm: "Incoterm", ready: "Ladebereit",
  option: "Option", transit: "ca. {days} Tage Transitzeit", valid_until: "gültig bis {date}", total: "Gesamt", includes: "Enthält",
  fx_note: "Beträge in {from} umgerechnet in {to} zu {source} vom {date}",
  per_shipment: "pro Sendung", per_bl: "pro B/L",
  assume_general: "Angeboten als nicht gefährliches, nicht temperaturgeführtes Stückgut.",
  assume_port: "Port-to-port-Leistung; nicht aufgeführte lokale Kosten sind nicht enthalten.",
  terms: "Alle Geschäfte unterliegen unseren {terms}.",
  ch_BASE: "Grundfracht", ch_OF: "Seefracht", ch_BAF: "Bunkerzuschlag (BAF)", ch_LSS: "Niedrigschwefelzuschlag", ch_EBS: "Notfall-Bunkerzuschlag",
  ch_THC: "Terminal Handling", ch_THC_O: "Terminal Handling Abgang", ch_THC_D: "Terminal Handling Bestimmung",
  ch_ISPS: "Hafensicherheit (ISPS)", ch_DOC: "Dokumentation", ch_CFS: "CFS-Handling", ch_PSS: "Hochsaisonzuschlag",
  ch_ETS: "EU-ETS-Zuschlag", ch_CAF: "Währungszuschlag", ch_GRI: "Allgemeine Ratenerhöhung", ch_CUSTOMS: "Verzollung",
  ch_OTHER: "Sonstiger Zuschlag", ch_MARGIN_FLAT: "Servicegebühr", ch_MARGIN_ADJ: "Mindest-Servicegebühr",
  fx_source_ecb: "EZB-Referenzkursen", fx_source_other: "Referenzkursen",
};

const es: Phrases = {
  greeting_formal_named: "Estimado/a {name}:",
  greeting_formal: "Estimados señores:",
  greeting_informal_named: "Hola, {name}:",
  greeting_informal: "Hola:",
  intro_thanks_for_request: "Gracias por su solicitud de cotización. A continuación encontrará nuestra oferta.",
  intro_thanks_for_interest: "Gracias por su interés en nuestros servicios. Nuestra oferta para su envío figura a continuación.",
  intro_following_up: "En relación con su consulta, le enviamos nuestra oferta a continuación.",
  closing_questions_welcome: "Si tiene alguna pregunta sobre esta oferta, no dude en indicárnoslo.",
  closing_look_forward: "Será un placer gestionar su envío.",
  closing_book_invite: "Para reservar, simplemente responda a este correo.",
  subject: "Cotización {route}",
  route: "Ruta", mode: "Modalidad", cargo: "Carga", incoterm: "Incoterm", ready: "Carga lista",
  option: "Opción", transit: "aprox. {days} días de tránsito", valid_until: "válida hasta {date}", total: "Total", includes: "Incluye",
  fx_note: "Importes en {from} convertidos a {to} según {source} del {date}",
  per_shipment: "por envío", per_bl: "por B/L",
  assume_general: "Cotizado como carga general no peligrosa y sin control de temperatura.",
  assume_port: "Servicio puerto a puerto; no se incluyen cargos locales distintos de los indicados.",
  terms: "Todas las operaciones están sujetas a nuestras {terms}.",
  ch_BASE: "Flete base", ch_OF: "Flete marítimo", ch_BAF: "Recargo por combustible (BAF)", ch_LSS: "Recargo bajo azufre", ch_EBS: "Recargo de emergencia por combustible",
  ch_THC: "Manipulación en terminal", ch_THC_O: "Manipulación en terminal de origen", ch_THC_D: "Manipulación en terminal de destino",
  ch_ISPS: "Seguridad portuaria (ISPS)", ch_DOC: "Documentación", ch_CFS: "Manipulación CFS", ch_PSS: "Recargo de temporada alta",
  ch_ETS: "Recargo EU ETS", ch_CAF: "Ajuste por divisa", ch_GRI: "Incremento general de tarifas", ch_CUSTOMS: "Despacho aduanero",
  ch_OTHER: "Otro recargo", ch_MARGIN_FLAT: "Cargo por servicio", ch_MARGIN_ADJ: "Cargo mínimo por servicio",
  fx_source_ecb: "los tipos de referencia del BCE", fx_source_other: "tipos de referencia",
};

const pt: Phrases = {
  greeting_formal_named: "Prezado(a) {name},",
  greeting_formal: "Prezados senhores,",
  greeting_informal_named: "Olá, {name},",
  greeting_informal: "Olá,",
  intro_thanks_for_request: "Obrigado pela sua solicitação de cotação. Segue abaixo a nossa proposta.",
  intro_thanks_for_interest: "Obrigado pelo seu interesse nos nossos serviços. A nossa proposta para o seu embarque segue abaixo.",
  intro_following_up: "Em seguimento à sua consulta, segue abaixo a nossa proposta.",
  closing_questions_welcome: "Se tiver dúvidas sobre esta proposta, por favor nos informe.",
  closing_look_forward: "Teremos prazer em cuidar do seu embarque.",
  closing_book_invite: "Para efetuar a reserva, basta responder a este e-mail.",
  subject: "Cotação {route}",
  route: "Rota", mode: "Modal", cargo: "Carga", incoterm: "Incoterm", ready: "Carga pronta",
  option: "Opção", transit: "aprox. {days} dias de trânsito", valid_until: "válida até {date}", total: "Total", includes: "Inclui",
  fx_note: "Valores em {from} convertidos para {to} pelas {source} de {date}",
  per_shipment: "por embarque", per_bl: "por B/L",
  assume_general: "Cotado como carga geral não perigosa e sem controle de temperatura.",
  assume_port: "Serviço porto a porto; taxas locais além das listadas não estão incluídas.",
  terms: "Todas as operações estão sujeitas às nossas {terms}.",
  ch_BASE: "Frete básico", ch_OF: "Frete marítimo", ch_BAF: "Ajuste de combustível (BAF)", ch_LSS: "Sobretaxa de baixo enxofre", ch_EBS: "Sobretaxa emergencial de combustível",
  ch_THC: "Movimentação no terminal", ch_THC_O: "Movimentação no terminal de origem", ch_THC_D: "Movimentação no terminal de destino",
  ch_ISPS: "Segurança portuária (ISPS)", ch_DOC: "Documentação", ch_CFS: "Manuseio CFS", ch_PSS: "Sobretaxa de alta temporada",
  ch_ETS: "Sobretaxa EU ETS", ch_CAF: "Ajuste cambial", ch_GRI: "Aumento geral de tarifas", ch_CUSTOMS: "Desembaraço aduaneiro",
  ch_OTHER: "Outra sobretaxa", ch_MARGIN_FLAT: "Taxa de serviço", ch_MARGIN_ADJ: "Taxa mínima de serviço",
  fx_source_ecb: "taxas de referência do BCE", fx_source_other: "taxas de referência",
};

const zh: Phrases = {
  greeting_formal_named: "尊敬的{name}：",
  greeting_formal: "尊敬的客户：",
  greeting_informal_named: "{name}，您好：",
  greeting_informal: "您好：",
  intro_thanks_for_request: "感谢您的询价，以下是我们的报价。",
  intro_thanks_for_interest: "感谢您对我们服务的关注，您货物的报价如下。",
  intro_following_up: "关于您的询价，现将我们的报价发送如下。",
  closing_questions_welcome: "如对本报价有任何疑问，请随时告知。",
  closing_look_forward: "期待为您安排运输。",
  closing_book_invite: "如需订舱，请直接回复本邮件。",
  subject: "报价 {route}",
  route: "航线", mode: "运输方式", cargo: "货物", incoterm: "贸易术语", ready: "货好时间",
  option: "方案", transit: "运输时间约 {days} 天", valid_until: "有效期至 {date}", total: "合计", includes: "包含",
  fx_note: "{from} 金额按 {source}（{date}）折算为 {to}",
  per_shipment: "每票", per_bl: "每份提单",
  assume_general: "按非危险品、非温控普通货物报价。",
  assume_port: "港到港服务；未列明的当地费用不包含在内。",
  terms: "所有业务均适用我们的{terms}。",
  ch_BASE: "基本运费", ch_OF: "海运费", ch_BAF: "燃油附加费 (BAF)", ch_LSS: "低硫附加费", ch_EBS: "紧急燃油附加费",
  ch_THC: "码头操作费", ch_THC_O: "起运港码头操作费", ch_THC_D: "目的港码头操作费",
  ch_ISPS: "港口安保费 (ISPS)", ch_DOC: "文件费", ch_CFS: "拼箱站操作费", ch_PSS: "旺季附加费",
  ch_ETS: "欧盟碳排放附加费", ch_CAF: "货币调整费", ch_GRI: "综合运价上调", ch_CUSTOMS: "报关费",
  ch_OTHER: "其他附加费", ch_MARGIN_FLAT: "服务费", ch_MARGIN_ADJ: "最低服务费",
  fx_source_ecb: "欧洲央行参考汇率", fx_source_other: "参考汇率",
};

export const PHRASES: Readonly<Record<Language, Phrases>> = { en, nl, de, es, pt, zh };

const KNOWN_CHARGES = new Set(["OF", "BAF", "LSS", "EBS", "THC_O", "THC_D", "ISPS", "DOC", "CFS", "PSS", "ETS", "CAF", "GRI", "CUSTOMS", "MARGIN_FLAT", "MARGIN_ADJ"]);

/** Phrase key for a tariff charge code — the customer never sees tariff free text. */
export function chargeKey(code: string): string {
  const c = code.toUpperCase();
  if (KNOWN_CHARGES.has(c)) return `ch_${c}`;
  if (c.startsWith("THC")) return "ch_THC";
  if (c.startsWith("BASE")) return "ch_BASE";
  if (c.startsWith("EXPORT_CUSTOMS") || c.startsWith("CUSTOMS")) return "ch_CUSTOMS";
  return "ch_OTHER";
}

export function phrase(language: Language, key: string, vars: Record<string, string> = {}): string {
  const dict = PHRASES[language];
  if (!dict) throw new Error(`unsupported language '${String(language)}'`);
  const template = dict[key] ?? PHRASES.en[key];
  if (template === undefined) throw new Error(`missing phrase key '${key}'`);
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}
