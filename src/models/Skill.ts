export interface Skill {
    id: number | string;
    name: string;
    desc: string;
    category: string;
    icon: string;
    colors: [string, string];
    isOfficial?: boolean;
    repoLink?: string;
}
