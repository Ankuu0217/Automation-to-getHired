/**
 * Reasonable tech/skill keyword list used for naive resume prefill
 * (server) and rendered as suggestions (client). Matching is
 * case-insensitive word-boundary matching against resume text.
 */
export const SKILL_KEYWORDS: string[] = [
  // Languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C++', 'C#', 'Ruby', 'PHP',
  'Swift', 'Kotlin', 'Scala', 'R', 'SQL', 'HTML', 'CSS', 'Bash',
  // Frontend
  'React', 'Next.js', 'Vue', 'Nuxt', 'Angular', 'Svelte', 'Redux', 'Tailwind CSS',
  'React Native', 'Flutter', 'Webpack', 'Vite', 'GraphQL', 'REST API',
  // Backend
  'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'Rails',
  'Laravel', 'gRPC', 'Microservices', 'WebSockets',
  // Data stores
  'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'Elasticsearch', 'DynamoDB', 'Cassandra',
  'SQLite', 'Firebase', 'Supabase', 'Kafka', 'RabbitMQ',
  // Cloud / DevOps
  'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Jenkins',
  'GitHub Actions', 'Linux', 'Nginx', 'Serverless', 'Lambda',
  // Data / AI
  'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy',
  'scikit-learn', 'LLM', 'NLP', 'Data Analysis', 'Spark', 'Airflow',
  // Practices
  'Agile', 'Scrum', 'TDD', 'System Design', 'Git', 'Testing', 'Jest', 'Cypress',
  'Playwright', 'Figma', 'Product Management',
];
