<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Builder;

use DateTime;
use SprykerEco\Zed\GoogleAnalytics\Communication\Form\AbstractGoogleAnalyticsFilterForm;

class EventCriteriaResolver implements EventCriteriaBuilderInterface
{
    protected const string DATE_FORMAT = 'Y-m-d';

    /**
     * @param array<string, mixed> $formData
     *
     * @return array{startDate: string, endDate: string}|null
     */
    public function resolveDateRange(array $formData): ?array
    {
        $dateRangePreset = $formData[AbstractGoogleAnalyticsFilterForm::FIELD_DATE_RANGE_PRESET] ?? null;

        if ($dateRangePreset) {
            return [
                'startDate' => (new DateTime($dateRangePreset))->format(static::DATE_FORMAT),
                'endDate' => (new DateTime())->format(static::DATE_FORMAT),
            ];
        }

        $startDate = $formData[AbstractGoogleAnalyticsFilterForm::FIELD_START_DATE] ?? null;
        $endDate = $formData[AbstractGoogleAnalyticsFilterForm::FIELD_END_DATE] ?? null;

        if (!$startDate instanceof DateTime || !$endDate instanceof DateTime) {
            return null;
        }

        return [
            'startDate' => $startDate->format(static::DATE_FORMAT),
            'endDate' => $endDate->format(static::DATE_FORMAT),
        ];
    }
}
