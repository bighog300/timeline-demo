type EventTemplate = {
  title: string;
  venue: string;
  city: string;
  category: string;
  priceRange: string;
  url: string;
  tags: string[];
  offsetDays: number;
  startHour: number;
  durationMinutes: number;
};

const eventTemplates: EventTemplate[] = [
  {
    title: 'City Lights Gallery Walk',
    venue: 'Riverfront Arts District',
    city: 'Portland',
    category: 'Arts',
    priceRange: '$$',
    url: 'https://example.com/events/city-lights-gallery',
    tags: ['gallery', 'walkable', 'evening'],
    offsetDays: 1,
    startHour: 18,
    durationMinutes: 120,
  },
  {
    title: 'Saturday Jazz Social',
    venue: 'Blue Note Lounge',
    city: 'Chicago',
    category: 'Music',
    priceRange: '$$',
    url: 'https://example.com/events/saturday-jazz-social',
    tags: ['live music', 'nightlife', 'weekend'],
    offsetDays: 2,
    startHour: 20,
    durationMinutes: 150,
  },
  {
    title: 'Morning Run + Coffee Meetup',
    venue: 'Harbor Park',
    city: 'Seattle',
    category: 'Wellness',
    priceRange: '$',
    url: 'https://example.com/events/morning-run-coffee',
    tags: ['fitness', 'community', 'outdoor'],
    offsetDays: 3,
    startHour: 15,
    durationMinutes: 75,
  },
  {
    title: 'Startup Pitch Night',
    venue: 'Innovation Hub',
    city: 'Austin',
    category: 'Business',
    priceRange: '$$',
    url: 'https://example.com/events/startup-pitch-night',
    tags: ['networking', 'tech', 'evening'],
    offsetDays: 4,
    startHour: 23,
    durationMinutes: 120,
  },
  {
    title: 'Pop-Up Food Market',
    venue: 'East Market Plaza',
    city: 'Denver',
    category: 'Food',
    priceRange: '$',
    url: 'https://example.com/events/pop-up-food-market',
    tags: ['family-friendly', 'local vendors', 'lunch'],
    offsetDays: 5,
    startHour: 18,
    durationMinutes: 180,
  },
  {
    title: 'Museum Late Hours',
    venue: 'Modern Arts Museum',
    city: 'San Francisco',
    category: 'Arts',
    priceRange: '$$',
    url: 'https://example.com/events/museum-late-hours',
    tags: ['exhibition', 'gallery', 'evening'],
    offsetDays: 6,
    startHour: 21,
    durationMinutes: 150,
  },
  {
    title: 'Sunday Farmers Market',
    venue: 'Old Town Square',
    city: 'Madison',
    category: 'Community',
    priceRange: '$',
    url: 'https://example.com/events/sunday-farmers-market',
    tags: ['outdoor', 'local food', 'weekend'],
    offsetDays: 7,
    startHour: 14,
    durationMinutes: 210,
  },
  {
    title: 'Design Systems Roundtable',
    venue: 'Studio Twenty',
    city: 'New York',
    category: 'Design',
    priceRange: '$$',
    url: 'https://example.com/events/design-systems-roundtable',
    tags: ['workshop', 'professional', 'afternoon'],
    offsetDays: 8,
    startHour: 19,
    durationMinutes: 90,
  },
  {
    title: 'Outdoor Movie Night',
    venue: 'Lakeside Amphitheater',
    city: 'Minneapolis',
    category: 'Entertainment',
    priceRange: '$',
    url: 'https://example.com/events/outdoor-movie-night',
    tags: ['family-friendly', 'evening', 'outdoor'],
    offsetDays: 9,
    startHour: 23,
    durationMinutes: 140,
  },
  {
    title: 'Culinary Lab: Seasonal Tasting',
    venue: 'Chef Collective',
    city: 'Boston',
    category: 'Food',
    priceRange: '$$$',
    url: 'https://example.com/events/seasonal-tasting',
    tags: ['tasting', 'limited seating', 'nightlife'],
    offsetDays: 10,
    startHour: 22,
    durationMinutes: 120,
  },
  {
    title: 'Community Beach Cleanup',
    venue: 'North Shore',
    city: 'Miami',
    category: 'Volunteer',
    priceRange: 'Free',
    url: 'https://example.com/events/beach-cleanup',
    tags: ['community', 'outdoor', 'morning'],
    offsetDays: 11,
    startHour: 13,
    durationMinutes: 120,
  },
  {
    title: 'Rooftop Yoga Flow',
    venue: 'Skyline Terrace',
    city: 'Los Angeles',
    category: 'Wellness',
    priceRange: '$$',
    url: 'https://example.com/events/rooftop-yoga-flow',
    tags: ['sunrise', 'wellness', 'outdoor'],
    offsetDays: 12,
    startHour: 14,
    durationMinutes: 60,
  },
];

const buildEventIso = (baseDate: Date, offsetDays: number, hourUTC: number) =>
  new Date(
    Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate() + offsetDays,
      hourUTC,
      0,
      0,
    ),
  );

const buildEvents = () => {
  const baseDate = new Date();

  return eventTemplates.map((template, index) => {
    const startDate = buildEventIso(baseDate, template.offsetDays, template.startHour);
    const endDate = new Date(startDate.getTime() + template.durationMinutes * 60 * 1000);

    return {
      id: `evt-${index + 1}`,
      title: template.title,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      venue: template.venue,
      city: template.city,
      category: template.category,
      price_range: template.priceRange,
      url: template.url,
      tags: template.tags,
    };
  });
};

export async function GET() {
  return Response.json(buildEvents());
}
