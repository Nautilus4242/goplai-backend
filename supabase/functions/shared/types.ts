export interface PersonalityTraits {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  comfortWithUncertainty: number;
  seekingNovelty: number;
  aestheticAppreciation: number;
  physicalActivityLevel: number;
  culturalCuriosity: number;
}

export interface Experience {
  id: string;
  name: string;
  description: string;
  category: string;
  location: any;
  rarity_score: number;
  difficulty_level: number;
  magic_level: number;
  estimated_duration: number;
  best_times: string[];
  weather_dependent: boolean;
  verification_status: string;
  status: string;
}

export interface RecommendationContext {
  userId: string;
  currentLocation: { lat: number; lng: number };
  timeAvailable: number;
  budget: number;
  groupSize: number;
  weather: string;
  timeOfDay: string;
}
