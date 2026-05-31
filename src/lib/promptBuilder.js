// Builds the full prompt for Betreuungsgutachten generation.
// Called by the generation route with all assembled context.

export function buildSystemPrompt() {
  return `Du bist ein erfahrener medizinischer Gutachter-Assistent, spezialisiert auf die Erstellung von Betreuungsgutachten nach deutschem BGB (§§ 1814 ff. BGB).

Deine Aufgabe ist es, auf Basis der bereitgestellten Unterlagen ein vollständiges, rechtlich korrektes und professionell formuliertes Betreuungsgutachten zu erstellen.

## Struktur eines Betreuungsgutachtens

Ein Betreuungsgutachten nach BGB muss folgende Abschnitte enthalten:

1. **Auftraggeber und Auftrag** — Gericht, Aktenzeichen, Auftragsdatum
2. **Angaben zur begutachteten Person** — Name (anonymisiert), Geburtsdatum, Wohnort, aktuelle Unterbringung
3. **Grundlagen des Gutachtens** — Untersuchungsdatum, Ort, verwendete Unterlagen, Quellen
4. **Vorgeschichte und Aktenlage** — Zusammenfassung der Krankengeschichte aus den Akten
5. **Untersuchungsbefund** — Körperlicher Befund, psychischer Befund, neuropsychologischer Befund
6. **Diagnose** — ICD-10/ICD-11 Diagnosen mit Codes
7. **Beurteilung der Betreuungsbedürftigkeit** — Begründung bezogen auf konkrete Lebensbereiche
8. **Empfohlene Betreuungsbereiche** — Spezifische Aufgabenkreise nach § 1815 BGB
9. **Erforderlichkeit und Verhältnismäßigkeit** — Abwägung anderer Hilfen
10. **Zusammenfassung und Empfehlung** — Klare Schlussempfehlung ans Gericht

## Stilrichtlinien

- Schreibe in einem sachlichen, juristisch-medizinischen Stil
- Verwende Fachterminologie korrekt aber verständlich
- Formuliere präzise und eindeutig — Gerichte brauchen klare Aussagen
- Vermeide Spekulationen — stütze jede Aussage auf die bereitgestellten Unterlagen
- Nutze den Stil und die Formulierungen aus den Beispielgutachten des Gutachters soweit passend
- Schreibe in der dritten Person über die begutachtete Person

## Wichtige rechtliche Hinweise

- Betreuung ist nur für Bereiche zu empfehlen, in denen tatsächlich Unterstützungsbedarf besteht
- Der Grundsatz der Verhältnismäßigkeit muss beachtet werden (§ 1815 Abs. 1 BGB)
- Formuliere keine Diagnosen ohne ausreichende Befundgrundlage
- Weise explizit auf Lücken in der Informationsgrundlage hin

Antworte ausschließlich mit dem Gutachten-Text in strukturiertem Format. Keine Einleitung, keine Erklärungen außerhalb des Gutachtens.`
}

export function buildUserPrompt({
  caseDocuments,
  ownFindings,
  retrievedChunks,
  template,
  patientRef,
  isDemo,
}) {
  const sections = []

  // Demo mode — generate a realistic but clearly placeholder output
  if (isDemo) {
    return `Erstelle eine Demo-Vorschau eines Betreuungsgutachtens für Demonstrationszwecke.
Verwende den Patientenreferenzcode: ${patientRef}
Füge an mehreren Stellen deutlich sichtbare Hinweise ein wie "[DEMO - Kein echtes Gutachten]".
Zeige die vollständige Struktur, aber fülle medizinische Details mit plausiblen aber fiktiven Beispieldaten.
Der Nutzer soll die Funktionalität des Systems verstehen können, ohne echte Daten zu sehen.`
  }

  sections.push(`# Auftrag

Erstelle ein vollständiges Betreuungsgutachten für den Patienten mit Referenzcode: **${patientRef}**`)

  // Template structure
  if (template?.content_json) {
    const templateText = typeof template.content_json === 'string'
      ? template.content_json
      : JSON.stringify(template.content_json, null, 2)

    sections.push(`# Vorlage / Gliederung

Nutze folgende Vorlage als Grundstruktur:

${templateText}`)
  }

  // RAG chunks — own writing style reference
  if (retrievedChunks?.length > 0) {
    const chunksText = retrievedChunks
      .map((c, i) => `### Beispiel ${i + 1} (Ähnlichkeit: ${(c.similarity * 100).toFixed(0)}%)\n${c.chunk_text}`)
      .join('\n\n')

    sections.push(`# Stilreferenz: Eigene frühere Gutachten

Die folgenden Textausschnitte stammen aus früheren Gutachten dieses Gutachters.
Übernehme den Stil, die Formulierungen und die Argumentationsstruktur soweit sinnvoll:

${chunksText}`)
  }

  // Case documents — medical records, lab reports, court orders
  if (caseDocuments?.length > 0) {
    const docsText = caseDocuments
      .filter(d => d.status === 'ready' && d.extracted_text)
      .map(d => `### ${docTypeLabel(d.doc_type)}: ${d.file_name}\n\n${d.extracted_text}`)
      .join('\n\n---\n\n')

    if (docsText) {
      sections.push(`# Vorliegende Unterlagen und Akten

${docsText}`)
    }
  }

  // Own findings — doctor's own notes entered as plain text
  if (ownFindings?.trim()) {
    sections.push(`# Eigene Untersuchungsbefunde des Gutachters

${ownFindings}`)
  }

  sections.push(`# Aufgabe

Erstelle jetzt das vollständige Betreuungsgutachten basierend auf allen oben bereitgestellten Informationen.
Halte dich an die vorgegebene Struktur und den beschriebenen Stil.
Weise auf fehlende Informationen hin, sofern sie für ein vollständiges Gutachten notwendig wären.`)

  return sections.join('\n\n---\n\n')
}

function docTypeLabel(docType) {
  const labels = {
    medical_scan: 'Medizinische Akte / Scan',
    lab_report: 'Laborbericht',
    own_findings: 'Eigene Befunde',
    court_order: 'Gerichtsbeschluss',
    other: 'Unterlage',
  }
  return labels[docType] || 'Unterlage'
}
