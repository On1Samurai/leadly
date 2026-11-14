import type { Category } from '../../shared/types'
import type { Priors } from '../core/scoring'
import categoriesJson from '../../../resources/data/categories.json'
import priorsJson from '../../../resources/data/priors.json'

export const CATEGORIES = categoriesJson as Category[]
export const PRIORS = priorsJson as Priors
