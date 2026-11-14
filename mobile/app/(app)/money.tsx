import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDashboard } from '@/api/queries';
import { BillsList } from '@/components/bills';
import { Card, Txt } from '@/components/ui';
import { money } from '@/format';
import { space } from '@/theme';

/** Owner: today's sales and dues at the top, then all bills (owner can give discounts on drafts). */
export default function MoneyTab() {
  const { t } = useTranslation();
  const d = useDashboard();
  const m = d.data?.money;
  return (
    <BillsList
      header={
        m ? (
          <Card style={{ flexDirection: 'row', gap: space[4] }}>
            <Txt style={{ flex: 1 }}>
              <Txt size="sm" muted>{t('billing.today_sales')}{'\n'}</Txt>
              <Txt size="lg" weight="bold">{money(m.sales_today)}</Txt>
            </Txt>
            <Txt style={{ flex: 1 }}>
              <Txt size="sm" muted>{t('customers.balance')}{'\n'}</Txt>
              <Txt size="lg" weight="bold" color="dangerText">{money(m.customer_dues)}</Txt>
            </Txt>
          </Card>
        ) : null
      }
    />
  );
}
