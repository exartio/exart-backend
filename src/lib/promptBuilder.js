// Builds the full prompt for Gutachten generation.
// Called by the generation route with all assembled context.

// ── System prompts by Gutachten type ─────────────────────────────────────────

const SYSTEM_PROMPTS = {

  betreuung: `Du bist ein erfahrener medizinischer Gutachter-Assistent, spezialisiert auf die Erstellung von Betreuungsgutachten nach deutschem BGB (§§ 1814 ff. BGB).

Deine Aufgabe ist es, auf Basis der bereitgestellten Unterlagen ein vollständiges, rechtlich korrektes und professionell formuliertes Betreuungsgutachten zu erstellen.

## Struktur eines Betreuungsgutachtens

1. Auftraggeber und Auftrag — Gericht, Aktenzeichen, Auftragsdatum
2. Angaben zur begutachteten Person — Name, Geburtsdatum, Wohnort, aktuelle Unterbringung
3. Grundlagen des Gutachtens — Untersuchungsdatum, Ort, verwendete Unterlagen
4. Vorgeschichte und Aktenlage — Zusammenfassung der Krankengeschichte
5. Untersuchungsbefund — Körperlicher, psychischer und neuropsychologischer Befund
6. Diagnose — ICD-10/ICD-11 Diagnosen mit Codes
7. Beurteilung der Betreuungsbedürftigkeit — Begründung bezogen auf konkrete Lebensbereiche
8. Beweisfragen — Einzeln und vollständig beantworten
9. Empfohlene Betreuungsbereiche — Aufgabenkreise nach § 1815 BGB
10. Erforderlichkeit und Verhältnismäßigkeit — Abwägung anderer Hilfen
11. Zusammenfassung und Empfehlung

## Stilrichtlinien
- Sachlicher, juristisch-medizinischer Stil
- Betreuung ist nur für Bereiche zu empfehlen, in denen tatsächlich Unterstützungsbedarf besteht
- Grundsatz der Verhältnismäßigkeit beachten (§ 1815 Abs. 1 BGB)
- Beweisfragen des Gerichts einzeln, vollständig und direkt beantworten
- Keine Diagnosen ohne ausreichende Befundgrundlage
- Dritte Person über die begutachtete Person

Antworte ausschließlich mit dem Gutachten-Text. Keine Einleitung, keine Erklärungen außerhalb des Gutachtens.`,

  allgemein: `Du bist ein erfahrener medizinischer Gutachter-Assistent, spezialisiert auf die Erstellung allgemeiner psychiatrischer und neurologischer Sachverständigengutachten.

Deine Aufgabe ist es, auf Basis der bereitgestellten Unterlagen ein vollständiges, fachlich korrektes und professionell formuliertes ärztliches Gutachten zu erstellen.

## Struktur eines allgemeinen Sachverständigengutachtens

1. Auftraggeber und Auftrag — Auftraggeber, Aktenzeichen, Fragestellung
2. Angaben zur begutachteten Person — Name, Geburtsdatum, Wohnort
3. Grundlagen des Gutachtens — Untersuchungsdatum, Ort, verwendete Unterlagen und Quellen
4. Vorgeschichte und Aktenlage — Zusammenfassung der relevanten Anamnese und Befunde
5. Untersuchungsbefund — Klinischer, psychischer und ggf. neuropsychologischer Befund
6. Diagnose — ICD-10/ICD-11 Diagnosen mit Codes, Differentialdiagnosen
7. Beurteilung — Beantwortung der Beweisfragen bezogen auf die erhobenen Befunde
8. Zusammenfassung und Schlussfolgerung

## Stilrichtlinien
- Sachlicher, medizinisch-wissenschaftlicher Stil
- Alle Aussagen durch erhobene Befunde und Unterlagen belegen
- Beweisfragen vollständig und präzise beantworten
- Differentialdiagnosen erwähnen wo relevant
- Keine spekulativen Aussagen über nicht untersuchte Bereiche
- Dritte Person über die begutachtete Person

Antworte ausschließlich mit dem Gutachten-Text. Keine Einleitung, keine Erklärungen außerhalb des Gutachtens.`,

  unterbringung: `Du bist ein erfahrener medizinischer Gutachter-Assistent, spezialisiert auf die Erstellung von Unterbringungsgutachten nach § 1831 BGB (betreuungsrechtliche Unterbringung).

Deine Aufgabe ist es, auf Basis der bereitgestellten Unterlagen ein vollständiges, rechtlich korrektes Gutachten zur Frage der Notwendigkeit einer stationären Unterbringung gegen den Willen des Betroffenen zu erstellen.

## Rechtliche Grundlage
§ 1831 BGB: Genehmigung des Betreuungsgerichts ist erforderlich wenn:
- Psychische Erkrankung oder Behinderung vorliegt
- Erhebliche Selbstgefährdung besteht
- Stationäre Behandlung notwendig ist
- Ambulante Behandlung nicht ausreicht
- Verhältnismäßigkeit gewahrt ist

## Struktur eines Unterbringungsgutachtens

1. Auftraggeber und Auftrag — Gericht, Aktenzeichen
2. Angaben zur Person — Name, Geburtsdatum, aktuelle Unterbringungssituation
3. Grundlagen des Gutachtens — Untersuchung, Unterlagen, Quellen
4. Vorgeschichte und Aktenlage — Krankheitsverlauf, bisherige Behandlungen
5. Untersuchungsbefund — Psychopathologischer und körperlicher Befund
6. Diagnose — ICD-10/ICD-11 mit Codes
7. Beurteilung der Unterbringungsvoraussetzungen
   - Vorliegen einer psychischen Erkrankung
   - Art und Ausmaß der Selbstgefährdung
   - Fehlende oder eingeschränkte Einsichts- und Steuerungsfähigkeit
   - Erforderlichkeit der stationären Behandlung
   - Verhältnismäßigkeit (mildestes geeignetes Mittel)
8. Beweisfragen — Einzeln und vollständig beantworten
9. Prognose und voraussichtliche Dauer
10. Zusammenfassung und Empfehlung

## Stilrichtlinien
- Besonders präzise Begründung der Gefährdungslage erforderlich
- Verhältnismäßigkeit explizit abwägen
- Alternative ambulante Maßnahmen benennen und deren Unzulänglichkeit begründen
- Dritte Person über die begutachtete Person

Antworte ausschließlich mit dem Gutachten-Text. Keine Einleitung, keine Erklärungen außerhalb des Gutachtens.`,

  zwangsmassnahmen: `Du bist ein erfahrener medizinischer Gutachter-Assistent, spezialisiert auf die Erstellung von Gutachten zu ärztlichen Zwangsmaßnahmen nach § 1832 BGB.

Deine Aufgabe ist es, auf Basis der bereitgestellten Unterlagen ein vollständiges, rechtlich korrektes Gutachten zur Frage der Notwendigkeit und Zulässigkeit einer ärztlichen Zwangsmaßnahme zu erstellen.

## Rechtliche Grundlage
§ 1832 BGB: Ärztliche Zwangsmaßnahme ist nur zulässig wenn ALLE folgenden Voraussetzungen kumulativ vorliegen:
1. Krankheitsbedingte Einsichtsunfähigkeit — Betroffener kann Notwendigkeit der Behandlung nicht erkennen
2. Erheblicher gesundheitlicher Schaden ohne Behandlung
3. Scheitern aller zumutbaren einwilligungsbasierten Alternativen (dokumentiert)
4. Verhältnismäßigkeit — Nutzen überwiegt eindeutig das Leid der Maßnahme
5. Durchführung nur in stationärem Rahmen
6. Gerichtliche Genehmigung (außer Gefahr im Verzug)

## Struktur eines Zwangsmaßnahmen-Gutachtens

1. Auftraggeber und Auftrag
2. Angaben zur Person — Name, Geburtsdatum, stationäre Behandlungssituation
3. Grundlagen des Gutachtens
4. Vorgeschichte — Krankheitsverlauf, bisherige Behandlungsversuche
5. Aktueller Befund — Psychopathologischer Befund, Einsichtsfähigkeit
6. Diagnose — ICD-10/ICD-11
7. Beurteilung der Zwangsmaßnahmen-Voraussetzungen
   - Nachweis der krankheitsbedingten Einsichtsunfähigkeit
   - Art der vorgesehenen Zwangsmaßnahme
   - Dokumentation gescheiterter Einwilligungsversuche
   - Nutzen-Risiko-Abwägung der spezifischen Maßnahme
   - Verhältnismäßigkeit und Erforderlichkeit
   - Berücksichtigung von Patientenverfügung / Vorsorgevollmacht
8. Beweisfragen — Einzeln und vollständig beantworten
9. Prognose — Voraussichtliche Dauer der Zwangsmaßnahme
10. Zusammenfassung und Empfehlung

## Stilrichtlinien
- Höchste Sorgfalt bei der Begründung aller Voraussetzungen — kumulative Prüfung
- Jede der 6 Voraussetzungen explizit und separat prüfen
- Gescheiterte Einwilligungsversuche konkret benennen
- BVerfG-Rechtsprechung (2011, 2013) im Blick behalten
- Dritte Person über die begutachtete Person

Antworte ausschließlich mit dem Gutachten-Text. Keine Einleitung, keine Erklärungen außerhalb des Gutachtens.`,
}

// ── Type labels ───────────────────────────────────────────────────────────────

export const GUTACHTEN_TYPES = {
  betreuung:       'Rechtliche Betreuung',
  allgemein:       'Allgemeines Sachverständigengutachten',
  unterbringung:   'Unterbringung nach BGB',
  zwangsmassnahmen: 'Zwangsmaßnahmen nach BGB',
}

// ── System prompt ─────────────────────────────────────────────────────────────

export function buildSystemPrompt(gutachtenType = 'betreuung') {
  return SYSTEM_PROMPTS[gutachtenType] || SYSTEM_PROMPTS.betreuung
}

// ── User prompt ───────────────────────────────────────────────────────────────

export function buildUserPrompt({
  caseDocuments,
  expertFindings = [],
  ownFindings,
  retrievedChunks,
  template,
  patientRef,
  beweisfragen,
  gutachtenType = 'betreuung',
  isDemo,
  caseRow,
}) {
  const sections = []
  const typeLabel = GUTACHTEN_TYPES[gutachtenType] || GUTACHTEN_TYPES.betreuung

  // Demo mode
  if (isDemo) {
    return `Erstelle eine Demo-Vorschau eines ${typeLabel} für Demonstrationszwecke.
Verwende den Patientenreferenzcode: ${patientRef}
Füge an mehreren Stellen deutlich sichtbare Hinweise ein wie "[DEMO - Kein echtes Gutachten]".
Zeige die vollständige Struktur, aber fülle medizinische Details mit plausiblen aber fiktiven Beispieldaten.`
  }

  // Build patient info block
  const patientInfo = []
  if (patientRef) patientInfo.push(`Name: **${patientRef}**`)
  if (caseRow?.betroffener_dob) patientInfo.push(`Geburtsdatum: ${new Date(caseRow.betroffener_dob).toLocaleDateString('de-DE')}`)
  if (caseRow?.betroffener_adresse) patientInfo.push(`Adresse: ${caseRow.betroffener_adresse}`)

  const courtInfo = []
  if (caseRow?.gericht) courtInfo.push(`Gericht: ${caseRow.gericht}`)
  if (caseRow?.aktenzeichen) courtInfo.push(`Aktenzeichen: ${caseRow.aktenzeichen}`)
  if (caseRow?.richter) courtInfo.push(`Richter/in: ${caseRow.richter}`)
  if (caseRow?.beschlussdatum) courtInfo.push(`Beschlussdatum: ${new Date(caseRow.beschlussdatum).toLocaleDateString('de-DE')}`)
  if (caseRow?.abgabefrist) courtInfo.push(`Abgabefrist: ${new Date(caseRow.abgabefrist).toLocaleDateString('de-DE')}`)

  sections.push(`# Auftrag

Erstelle ein vollständiges **${typeLabel}**.

## Begutachtete Person
${patientInfo.join('  \n') || `Referenz: ${patientRef}`}

${courtInfo.length > 0 ? `## Gerichtliche Beauftragung\n${courtInfo.join('  \n')}` : ''}`)

  // Template structure
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

  // RAG chunks
  if (retrievedChunks?.length > 0) {
    const chunksText = retrievedChunks
      .map((c, i) => `### Beispiel ${i + 1} (Ähnlichkeit: ${(c.similarity * 100).toFixed(0)}%)\n${c.chunk_text}`)
      .join('\n\n')

    sections.push(`# Stilreferenz: Eigene frühere Gutachten

Die folgenden Textausschnitte stammen aus früheren Gutachten dieses Gutachters.
Übernehme den Stil, die Formulierungen und die Argumentationsstruktur soweit sinnvoll:

${chunksText}`)
  }

  // Expert findings — from expert_findings table (uploaded via own-finding route)
  // These are the physician's own examination results and have highest priority
  if (expertFindings?.length > 0) {
    const ready = expertFindings.filter(d => d.status === 'ready' && d.extracted_text && !d.ignored)

    if (ready.length > 0) {
      const findingTypeLabels = {
        exploration:  'Exploration',
        untersuchung: 'Untersuchungsbefund',
        amdp:         'AMDP-Befund',
        anamnese:     'Fremd-/Anamnese',
        sonstig:      'Sonstiger Befund',
      }

      const findingsText = ready
        .map((d, i) => `### B${i + 1} — ${findingTypeLabels[d.doc_type] || d.doc_type}: ${d.file_name}\n\n${d.extracted_text}`)
        .join('\n\n---\n\n')

      sections.push(`# Eigene Untersuchungsbefunde des Gutachters (PRIORITÄT)

WICHTIG: Die folgenden Befunde wurden vom Sachverständigen persönlich erhoben. Sie sind verbindlich und müssen wortgetreu und vollständig in das Gutachten übernommen werden. Sie haben höchste Priorität gegenüber allen anderen Unterlagen.

${findingsText}`)
    }
  }

  // Case documents — all treated as external source documents
  if (caseDocuments?.length > 0) {
    const ready = caseDocuments.filter(d => d.status === 'ready' && d.extracted_text && !d.ignored)

    if (ready.length > 0) {
      const extText = ready
        .map((d, i) => `### Q${i + 1} — ${docTypeLabel(d.doc_type)}: ${d.file_name}\n\n${d.extracted_text}`)
        .join('\n\n---\n\n')

      sections.push(`# Vorliegende Fremdunterlagen und Akten

Die folgenden Unterlagen stammen aus externen Quellen und dienen als Referenz. Sie sind nach fachlichem Ermessen zu würdigen.

${extText}`)
    }
  }

  // Own findings
  if (ownFindings) {
    const findingsTypeLabels = {
      exploration:  'Exploration',
      untersuchung: 'Untersuchung',
      amdp:         'AMDP-Befund',
      anamnese:     'Fremd-/Anamnese',
      sonstig:      'Sonstiger Befund',
    }

    let findingsText = ''
    if (Array.isArray(ownFindings) && ownFindings.length > 0) {
      findingsText = ownFindings
        .map(f => `### ${findingsTypeLabels[f.type] || f.type}\n${f.text}`)
        .join('\n\n')
    } else if (typeof ownFindings === 'string' && ownFindings.trim()) {
      findingsText = ownFindings.trim()
    }

    if (findingsText) {
      sections.push(`# Eigene Untersuchungsbefunde des Gutachters\n\nDie folgenden Befunde wurden vom Gutachter persönlich erhoben und sind gegliedert nach Befundtyp. Übernehme diese Befunde wortgetreu in die entsprechenden Kapitel des Gutachtens:\n\n${findingsText}`)
    }
  }

  // Beweisfragen
  if (beweisfragen?.length > 0) {
    const fragenText = beweisfragen
      .map((f, i) => `${i + 1}. ${f}`)
      .join('\n')

    sections.push(`# Beweisfragen des Gerichts

Das Gericht hat folgende Beweisfragen gestellt, die im Gutachten einzeln und vollständig zu beantworten sind:

${fragenText}

WICHTIG: Beantworte jede dieser Fragen explizit, vollständig und in der gleichen Reihenfolge. Leite jede Antwort mit der Frage ein.`)
  }

  // Type-specific closing instruction
  const typeInstructions = {
    betreuung: 'Beachte besonders die Verhältnismäßigkeit (§ 1815 BGB) und empfehle nur notwendige Aufgabenkreise.',
    allgemein: 'Beantworte die Beweisfragen präzise auf Basis der erhobenen Befunde.',
    unterbringung: 'Prüfe alle Voraussetzungen des § 1831 BGB explizit. Begründe die Erforderlichkeit und Verhältnismäßigkeit der Unterbringung.',
    zwangsmassnahmen: 'Prüfe ALLE 6 kumulativen Voraussetzungen des § 1832 BGB einzeln und explizit. Jede nicht erfüllte Voraussetzung schließt die Zulässigkeit aus.',
  }

  sections.push(`# Aufgabe

Erstelle jetzt das vollständige ${typeLabel} basierend auf allen oben bereitgestellten Informationen.
Halte dich an die vorgegebene Struktur und den beschriebenen Stil.
${typeInstructions[gutachtenType] || ''}
${beweisfragen?.length > 0 ? 'Beantworte alle Beweisfragen des Gerichts einzeln und vollständig.' : ''}
Weise auf fehlende Informationen hin, sofern sie für ein vollständiges Gutachten notwendig wären.`)

  return sections.join('\n\n---\n\n')
}

function docTypeLabel(docType) {
  const labels = {
    medical_scan: 'Medizinische Akte / Scan',
    lab_report:   'Laborbericht',
    own_findings: 'Eigene Befunde',
    court_order:  'Gerichtsbeschluss',
    other:        'Unterlage',
  }
  return labels[docType] || 'Unterlage'
}