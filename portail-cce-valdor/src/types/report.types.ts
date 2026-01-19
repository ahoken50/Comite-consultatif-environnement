export type ReportSectionType = 'cover' | 'intro' | 'stats' | 'projects' | 'members' | 'recommendations' | 'text' | 'conclusion';

export interface ReportSection {
    id: string;
    type: ReportSectionType;
    title: string;
    subtitle?: string;
    config: any;
}

export interface ReportTemplate {
    id: string;
    name: string;
    sections: ReportSection[];
}

export const SECTION_TYPES: { type: ReportSectionType; label: string; defaultTitle: string }[] = [
    { type: 'cover', label: 'Page de couverture', defaultTitle: 'Rapport Annuel' },
    { type: 'intro', label: 'Introduction', defaultTitle: 'Mot du Président' },
    { type: 'stats', label: 'Statistiques Globales', defaultTitle: 'Performance en chiffres' },
    { type: 'projects', label: 'Liste des Projets', defaultTitle: 'Projets Analysés' },
    { type: 'recommendations', label: 'Recommandations', defaultTitle: 'Recommandations au Conseil' },
    { type: 'members', label: 'Membres & Présences', defaultTitle: 'Implication des Membres' },
    { type: 'text', label: 'Texte Libre', defaultTitle: 'Section Personnalisée' },
    { type: 'conclusion', label: 'Conclusion', defaultTitle: 'Conclusion' }
];
