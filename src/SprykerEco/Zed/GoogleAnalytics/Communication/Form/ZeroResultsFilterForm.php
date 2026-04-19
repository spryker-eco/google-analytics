<?php

/**
 * This file is part of the Spryker Suite.
 * For full license information, please view the LICENSE file that was distributed with this source code.
 */

declare(strict_types=1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Form;

use Symfony\Component\Form\Extension\Core\Type\IntegerType;
use Symfony\Component\Form\FormBuilderInterface;
use Symfony\Component\OptionsResolver\OptionsResolver;

class ZeroResultsFilterForm extends AbstractGoogleAnalyticsFilterForm
{
    public const string FIELD_MINIMUM_COUNT = 'minimumCount';

    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        parent::buildForm($builder, $options);

        $builder->add(static::FIELD_MINIMUM_COUNT, IntegerType::class, [
            'required' => false,
            'data' => 0,
        ]);
    }
}
