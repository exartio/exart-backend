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
8. **Beweisfragen** — Sofern vom Gericht Beweisfragen gestellt wurden, sind diese hier einzeln und vollständig zu beantworten
9. **Empfohlene Betreuungsbereiche** — Spezifische Aufgabenkreise nach § 1815 BGB
10. **Erforderlichkeit und Verhältnismäßigkeit** — Abwägung anderer Hilfen
11. **Zusammenfassung und Empfehlung** — Klare Schlussempfehlung ans Gericht

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
- Beweisfragen des Gerichts sind einzeln, vollständig und direkt zu beantworten

Antworte ausschließlich mit dem Gutachten-Text in strukturiertem Format. Keine Einleitung, keine Erklärungen außerhalb des Gutachtens.`
}

export function buildUserPrompt({
  caseDocuments,
  ownFindings,
  retrievedChunks,
  template,
  patientRef,
  beweisfragen,
  isDemo,
}) {
  const sections = []

  // Demo mode
  if (isDemo) {
    return `Erstelle eine Demo-Vorschau eines Betreuungsgutachtens für Demonstrationszwecke.
Verwende den Patientenreferenzcode: ${patientRef}
Füge an mehreren Stellen deutlich sichtbare Hinweise ein wie "[DEMO - Kein echtes Gutachten]".
Zeige die vollständige Struktur, aber fülle medizinische Details mit plausiblen aber fiktiven Beispieldaten.
Der Nutzer soll die Funktionalität des Systems verstehen können, ohne echte Daten zu sehen.`
  }

  sections.push(`# Auftrag

Erstelle ein vollständiges Betreuungsgutachten für den Patienten mit Referenzcode: **${patientRef}**`)

  // Template structure — hybrid: JSON structure + raw text reference
  if (template?.content_json || template?.raw_text) {
    const struct = template.content_json || {}
    const parts  = []

    if (struct.chapters?.length > 0) {
      parts.push(`## Kapitelreihenfolge\n${struct.chapters.map((c, i) => `${i + 1}. ${c}`).join('\n')}`)
    }
    if (struct.intro) {
      parts.push(`## Standardeinleitung\n${struct.intro}`)
    }
    if (struct.closing) {
      parts.push(`## Schlussformel / Autorenschaft\n${struct.closing}`)
    }
    if (struct.style_notes) {
      parts.push(`## Stilhinweise\n${struct.style_notes}`)
    }
    if (template.raw_text && parts.length === 0) {
      parts.push(`## Vorlagentext\n${template.raw_text.slice(0, 3000)}`)
    }
    if (parts.length > 0) {
      sections.push(`# Gutachten-Vorlage: ${template.name || 'Standard'}

Verwende diese Vorlage als verbindliche Grundstruktur. Halte die Kapitelreihenfolge ein und übernehme Einleitungs- und Schlussformulierungen wortgetreu.

${parts.join('\n\n')}`)
    }
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

  // Case documents
  if (caseDocuments?.length > 0) {
    const docsText = caseDocuments
      .filter(d => d.status === 'ready' && d.extracted_text && !d.ignored)
      .map(d => `### ${docTypeLabel(d.doc_type)}: ${d.file_name}\n\n${d.extracted_text}`)
      .join('\n\n---\n\n')

    if (docsText) {
      sections.push(`# Vorliegende Unterlagen und Akten

${docsText}`)
    }
  }

  // Own findings — structured by type
  if (ownFindings) {
    const findingsTypeLabels = {
      exploration:  'Exploration',
      untersuchung: 'Untersuchung',
      amdp:         'AMDP-Befund',
      anamnese:     'Fremd-/Anamnese',
      sonstig:      'Sonstiger Befund',
    }

    // Accept both legacy plain string and new structured array
    let findingsText = ''
    if (Array.isArray(ownFindings) && ownFindings.length > 0) {
      findingsText = ownFindings
        .map(f => `### ${findingsTypeLabels[f.type] || f.type}
${f.text}`)
        .join('

')
    } else if (typeof ownFindings === 'string' && ownFindings.trim()) {
      findingsText = ownFindings.trim()
    }

    if (findingsText) {
      sections.push(`# Eigene Untersuchungsbefunde des Gutachters

Die folgenden Befunde wurden vom Gutachter persönlich erhoben und sind gegliedert nach Befundtyp. Übernehme diese Befunde wortgetreu in die entsprechenden Kapitel des Gutachtens:

${findingsText}`)
    }
  }

  // Beweisfragen — court expert questions
  if (beweisfragen?.length > 0) {
    const fragenText = beweisfragen
      .map((f, i) => `${i + 1}. ${f}`)
      .join('\n')

    sections.push(`# Beweisfragen des Gerichts

Das Gericht hat folgende Beweisfragen gestellt, die im Gutachten unter dem Kapitel "Beweisfragen" einzeln und vollständig zu beantworten sind:

${fragenText}

WICHTIG: Beantworte jede dieser Fragen explizit, vollständig und in der gleichen Reihenfolge unter dem Kapitel "VIII. Beweisfragen". Leite jede Antwort mit der Frage ein.`)
  }

  sections.push(`# Aufgabe

Erstelle jetzt das vollständige Betreuungsgutachten basierend auf allen oben bereitgestellten Informationen.
Halte dich an die vorgegebene Struktur und den beschriebenen Stil.
${beweisfragen?.length > 0 ? 'Beantworte alle Beweisfragen des Gerichts einzeln und vollständig unter Kapitel VIII.' : ''}
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