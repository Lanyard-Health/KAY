import { prisma } from '../src/utils/prisma.js';

async function main() {
  const practice = await prisma.practice.findFirst({
    where: { name: 'Lanyard Demo Behavioral Health' },
  });
  if (!practice) {
    console.error('Demo practice not found — run seed-demo-kaiser.ts first');
    process.exit(1);
  }

  const existing = await prisma.user.findFirst({
    where: { role: 'credentialing_staff', isActive: true },
  });
  const user = existing ?? await prisma.user.create({
    data: {
      cognitoId: 'dev-staff-cognito-id',
      email: 'staff@dev.local',
      firstName: 'Dev',
      lastName: 'Admin',
      role: 'credentialing_staff',
      isActive: true,
    },
  });
  if (existing) {
    console.log(`User exists: ${user.id} (${user.email})`);
  } else {
    console.log(`Created user: ${user.id} (${user.email})`);
  }

  const link = await prisma.userPractice.findFirst({
    where: { userId: user.id, practiceId: practice.id },
  });
  if (link) {
    console.log(`UserPractice link exists: ${link.id}`);
    return;
  }

  await prisma.userPractice.create({
    data: {
      userId: user.id,
      practiceId: practice.id,
      role: 'PRACTICE_STAFF',
    },
  });

  console.log(`Created staff user: ${user.id} (${user.email}) → practice ${practice.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
