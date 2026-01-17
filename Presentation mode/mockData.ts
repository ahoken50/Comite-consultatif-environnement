
import { Meeting } from './types';

export const MOCK_MEETING: Meeting = {
  id: 'mtg-2024-001',
  title: 'Comité Consultatif en Environnement - Séance de Mars',
  date: '2024-03-15',
  agenda: [
    {
      id: 'item-1',
      title: 'Ouverture de la séance et adoption de l\'ordre du jour',
      description: 'Accueil des membres et validation formelle de la structure de la réunion.',
      presenter: 'Julie Deschamps (Présidente)',
      durationInMinutes: 5,
      attachments: [
        { id: 'att-1', name: 'Ordre du jour final.pdf', url: 'https://picsum.photos/seed/agenda/1200/1600', type: 'image' }
      ]
    },
    {
      id: 'item-2',
      title: 'Projet de canopée urbaine - Secteur Nord',
      description: 'Analyse du rapport de plantation pour les quartiers résidentiels du nord. Discussion sur les essences d\'arbres sélectionnées.',
      presenter: 'Marc-André Villeneuve',
      durationInMinutes: 20,
      attachments: [
        { id: 'att-2', name: 'Plan de plantation.pdf', url: 'https://picsum.photos/seed/trees/1200/1600', type: 'image' },
        { id: 'att-3', name: 'Budget estimé.png', url: 'https://picsum.photos/seed/budget/1200/1600', type: 'image' }
      ]
    },
    {
      id: 'item-3',
      title: 'Nouvelle politique de gestion des matières résiduelles',
      description: 'Présentation des nouveaux bacs de compostage et calendrier de collecte 2024-2025.',
      presenter: 'Sophie Lavoie',
      durationInMinutes: 15,
      attachments: [
        { id: 'att-4', name: 'Guide de tri.pdf', url: 'https://picsum.photos/seed/recycling/1200/1600', type: 'image' }
      ]
    },
    {
      id: 'item-4',
      title: 'Subvention "Toits Verts" : Étude de cas',
      description: 'Retour sur les 3 premiers projets subventionnés en centre-ville.',
      presenter: 'Julie Deschamps',
      durationInMinutes: 25,
      attachments: [
        { id: 'att-5', name: 'Photos avant-après.jpg', url: 'https://picsum.photos/seed/roofs/1200/1600', type: 'image' }
      ]
    },
    {
      id: 'item-5',
      title: 'Varia et clôture',
      description: 'Questions diverses et levée de l\'assemblée.',
      presenter: 'Tous',
      durationInMinutes: 10,
      attachments: []
    }
  ]
};
