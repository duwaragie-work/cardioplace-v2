export interface PregnancyInfo {
  category: string | null
  warning: string | null
}

export interface DrugEnrichment {
  rxcui: string
  canonicalDrugName: string
  pillImageUrl: string | null
  plainLanguageDescription: string | null
  pregnancy: PregnancyInfo | null
  source: 'rxnorm+dailymed+openfda'
}
