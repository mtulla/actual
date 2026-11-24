import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Paragraph } from '@actual-app/components/paragraph';
import { View } from '@actual-app/components/view';

import { Link } from '#components/common/Link';
import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { Checkbox } from '#components/forms';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useSyncedPref } from '#hooks/useSyncedPref';

export function CategoryLearning() {
  const { t } = useTranslation();
  const [learnCategories = 'true', setLearnCategories] =
    useSyncedPref('learn-categories');
  const isLearnCategoriesEnabled = String(learnCategories) === 'true';
  const isSuggestionsEnabled = useFeatureFlag('transactionSuggestions');
  const [learnAsSuggestions, setLearnAsSuggestions] = useSyncedPref(
    'learn-categories-as-suggestions',
  );

  return (
    <Modal
      name="payee-category-learning"
      containerProps={{ style: { width: 600 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Category Learning')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <Paragraph>
            <Trans>
              <strong>Category Learning</strong> will automatically determine
              the best category for a transaction and create a rule that sets
              the category for the payee.{' '}
              <Link
                variant="external"
                to="https://actualbudget.org/docs/budgeting/rules/#automatic-rules"
                linkColor="purple"
              >
                Learn more
              </Link>
            </Trans>
          </Paragraph>
          <Paragraph>
            <Trans>
              Disabling Category Learning will not delete any existing rules but
              will prevent new rules from being created automatically on a
              global level.
            </Trans>
          </Paragraph>
          <Button
            onPress={() =>
              setLearnCategories(String(!isLearnCategoriesEnabled))
            }
            variant={isLearnCategoriesEnabled ? 'normal' : 'primary'}
          >
            {isLearnCategoriesEnabled ? (
              <Trans>Disable category learning</Trans>
            ) : (
              <Trans>Enable category learning</Trans>
            )}
          </Button>
          {isSuggestionsEnabled && isLearnCategoriesEnabled && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 15,
              }}
            >
              <Checkbox
                id="learn-categories-as-suggestions"
                checked={learnAsSuggestions === 'true'}
                onChange={() =>
                  setLearnAsSuggestions(String(learnAsSuggestions !== 'true'))
                }
              />
              <label htmlFor="learn-categories-as-suggestions">
                <Trans>
                  Create new automatic rules as suggestions, so a category is
                  proposed for review instead of set
                </Trans>
              </label>
            </View>
          )}
        </>
      )}
    </Modal>
  );
}
