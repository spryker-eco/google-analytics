<?php

/**
 * This file is part of the Spryker Suite.
 * For full license information, please view the LICENSE file that was distributed with this source code.
 */

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Builder;

interface EventCriteriaBuilderInterface
{
    /**
     * @param array<string, mixed> $formData
     *
     * @return array{startDate: string, endDate: string}|null
     */
    public function resolveDateRange(array $formData): ?array;
}
