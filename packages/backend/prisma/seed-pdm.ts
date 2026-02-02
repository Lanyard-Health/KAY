import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding PDM test data...\n');

  // Get existing providers
  const providers = await prisma.provider.findMany({
    take: 5,
    include: {
      payerEnrollments: {
        include: { payer: true }
      }
    }
  });

  if (providers.length === 0) {
    console.log('No providers found. Creating a test provider...\n');

    // Create a test provider
    const provider = await prisma.provider.create({
      data: {
        npi: '1234567890',
        firstName: 'John',
        lastName: 'Smith',
        suffix: 'MD',
        dateOfBirth: new Date('1975-06-15'),
        gender: 'male',
        email: 'john.smith@example.com',
        phone: '(512) 555-1234',
        providerType: 'psychiatrist',
        taxonomy: '2084P0800X',
        specialties: ['Psychiatry', 'Adult Psychiatry'],
        languages: ['English', 'Spanish'],
        status: 'active',
        lastDirectoryUpdateAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days ago
      },
    });

    // Create payers if they don't exist
    const payerData = [
      { name: 'Aetna', payerId: 'AETNA001', payerType: 'Commercial' },
      { name: 'Blue Cross Blue Shield', payerId: 'BCBS001', payerType: 'Commercial' },
      { name: 'Cigna', payerId: 'CIGNA001', payerType: 'Commercial' },
      { name: 'UnitedHealthcare', payerId: 'UHC001', payerType: 'Commercial' },
      { name: 'Medicare', payerId: 'MEDICARE001', payerType: 'Medicare' },
    ];

    const payers = [];
    for (const p of payerData) {
      const payer = await prisma.payer.upsert({
        where: { payerId: p.payerId },
        update: {},
        create: p,
      });
      payers.push(payer);
    }

    const now = new Date();

    // Create enrollments with various PDM states
    // 1. Current (attested 30 days ago)
    await prisma.payerEnrollment.create({
      data: {
        providerId: provider.id,
        payerId: payers[0].id,
        status: 'approved',
        effectiveDate: new Date('2023-01-15'),
        recredentialingDate: new Date('2026-01-15'),
        pdmLastAttestedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        pdmLastAttestedBy: 'admin@clinic.com',
        pdmEnabled: true,
      },
    });

    // 2. Due Soon (attested 80 days ago)
    await prisma.payerEnrollment.create({
      data: {
        providerId: provider.id,
        payerId: payers[1].id,
        status: 'approved',
        effectiveDate: new Date('2022-06-01'),
        recredentialingDate: new Date('2025-06-01'),
        pdmLastAttestedAt: new Date(now.getTime() - 80 * 24 * 60 * 60 * 1000),
        pdmLastAttestedBy: 'admin@clinic.com',
        pdmEnabled: true,
      },
    });

    // 3. Overdue (attested 120 days ago)
    await prisma.payerEnrollment.create({
      data: {
        providerId: provider.id,
        payerId: payers[2].id,
        status: 'approved',
        effectiveDate: new Date('2023-03-01'),
        recredentialingDate: new Date('2026-03-01'),
        pdmLastAttestedAt: new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000),
        pdmLastAttestedBy: 'admin@clinic.com',
        pdmEnabled: true,
      },
    });

    // 4. Never Attested
    await prisma.payerEnrollment.create({
      data: {
        providerId: provider.id,
        payerId: payers[3].id,
        status: 'approved',
        effectiveDate: new Date('2025-11-01'),
        recredentialingDate: new Date('2028-11-01'),
        pdmLastAttestedAt: null,
        pdmLastAttestedBy: null,
        pdmEnabled: true,
      },
    });

    // 5. Current but needs update (attested before directory change)
    await prisma.payerEnrollment.create({
      data: {
        providerId: provider.id,
        payerId: payers[4].id,
        status: 'approved',
        effectiveDate: new Date('2020-01-01'),
        recredentialingDate: new Date('2026-01-01'),
        pdmLastAttestedAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
        pdmLastAttestedBy: 'admin@clinic.com',
        pdmEnabled: true,
      },
    });

    console.log(`Created test provider: ${provider.firstName} ${provider.lastName} (${provider.id})`);
    console.log('Created 5 enrollments with various PDM states\n');

  } else {
    console.log(`Found ${providers.length} existing provider(s). Updating PDM data...\n`);

    for (const provider of providers) {
      // Update provider with directory change timestamp
      await prisma.provider.update({
        where: { id: provider.id },
        data: {
          lastDirectoryUpdateAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days ago
        },
      });

      const enrollments = provider.payerEnrollments;
      const now = new Date();

      for (let i = 0; i < enrollments.length; i++) {
        const enrollment = enrollments[i];
        let pdmData: { pdmLastAttestedAt: Date | null; pdmLastAttestedBy: string | null; pdmEnabled: boolean };

        switch (i % 5) {
          case 0: // Current
            pdmData = {
              pdmLastAttestedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
              pdmLastAttestedBy: 'admin@clinic.com',
              pdmEnabled: true,
            };
            break;
          case 1: // Due Soon
            pdmData = {
              pdmLastAttestedAt: new Date(now.getTime() - 80 * 24 * 60 * 60 * 1000),
              pdmLastAttestedBy: 'admin@clinic.com',
              pdmEnabled: true,
            };
            break;
          case 2: // Overdue
            pdmData = {
              pdmLastAttestedAt: new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000),
              pdmLastAttestedBy: 'admin@clinic.com',
              pdmEnabled: true,
            };
            break;
          case 3: // Never Attested
            pdmData = {
              pdmLastAttestedAt: null,
              pdmLastAttestedBy: null,
              pdmEnabled: true,
            };
            break;
          default: // Current but needs update
            pdmData = {
              pdmLastAttestedAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
              pdmLastAttestedBy: 'admin@clinic.com',
              pdmEnabled: true,
            };
        }

        await prisma.payerEnrollment.update({
          where: { id: enrollment.id },
          data: pdmData,
        });

        const statusLabels = ['Current', 'Due Soon', 'Overdue', 'Never Attested', 'Needs Update'];
        console.log(`  - ${enrollment.payer.name}: ${statusLabels[i % 5]}`);
      }

      console.log(`\nUpdated provider: ${provider.firstName} ${provider.lastName} (${provider.id})`);
      console.log(`  Updated ${enrollments.length} enrollment(s)\n`);
    }
  }

  console.log('PDM test data summary:');
  console.log('  - Current (green): Attested within 76 days');
  console.log('  - Due Soon (yellow): 77-90 days since attestation');
  console.log('  - Overdue (red): >90 days since attestation');
  console.log('  - Never Attested (gray): No attestation recorded');
  console.log('  - Needs Update (orange): Directory changed since last attestation');
  console.log('\nSeeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
